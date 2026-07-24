# Pre-embedding formatting & chunking for candidate resumes — Design

**Date:** 2026-07-24
**Status:** Design approved by Rick, not yet implemented
**Approach:** App-side TS module (`src/services/format.ts`) with two pure functions;
the n8n data-steward workflow consumes an already-chunked field via a one-line
change — no new n8n-side logic, no new network round trips.
**Sequencing:** Builds on the approved-but-unimplemented
`docs/superpowers/specs/2026-07-24-pii-redaction-design.md`. Both specs touch
`ingestCandidate`'s return value and the same n8n data-steward line, so this work
lands **with or after** redaction — never before.

## Goal

Candidate resume text is embedded (Gemini `embedContent`, 3072-dim, stored in
`embeddings.content`) after being sliced by a naive fixed-width chunker. Improve
the quality of what gets embedded — so each stored vector represents a coherent
unit of text, not a fragment that starts and ends mid-thought — without changing
the recruiter-facing original resume record.

## Prior investigation — grounded in real data

Five real JobDiva resume PLAINTEXT samples were pulled live (job `23-00053`, via a
throwaway `scripts/resume-sample-pull.ts`) and analyzed structurally (raw text kept
in a scratchpad, never printed). Findings drove the scope:

- **JobDiva PLAINTEXT is already clean.** `getResumeText` (`src/services/jobdiva.ts`)
  returns the `PLAINTEXT` field with only `.trim()` applied — but that field arrives
  well-formed. Across five 9K–24K-char resumes: **13 en-dashes total, 38 multi-space
  runs, 111 trailing-whitespace occurrences, and zero** tabs / bullets / CRLF / nbsp /
  hyphenation-breaks / EEO-boilerplate / page-number artifacts. The classic
  PDF-extraction mess does not exist for this source.
- **The chunker is the real quality lever.** The naive slicer
  (`n8n/workflows/src/helpers.js` `chunkText`, 1500-char windows / 200 overlap) cuts
  blind: **13 of 15 chunk boundaries in the largest sample landed mid-word /
  mid-sentence** (a chunk ends `'o'`, the next starts lowercase). Every stored vector
  therefore represents a mid-thought fragment.
- **There is clean structure to exploit.** Consistent ALL-CAPS section headers
  appear across resumes (`PROFESSIONAL EXPERIENCE`, `EDUCATION`, `SUMMARY`, `SKILLS`,
  `QUALIFICATIONS`, `CERTIFICATION`) plus paragraph blocks — but structure varies
  (some resumes are richly sectioned, others nearly flat), so the splitter must
  handle both uniformly rather than assume headers exist.

## Decisions made

- **Scope is structure-aware chunking + light normalization only.** Boilerplate/EEO
  stripping, PDF-artifact repair, header/footer/page-number removal are explicitly
  dropped as YAGNI — real data shows those problems don't exist for the JobDiva
  source. If a future non-JobDiva source introduces them, revisit then.
- **Logic lives in TypeScript** (`src/services/format.ts`), not inline n8n Code-node
  JS — same rationale as the redaction spec: this repo keeps real logic in
  `src/services/*.ts` (deep modules, unit-testable with Vitest) with n8n as thin
  dispatch. No new network round trips (piggybacks on the ingest call that already
  happens).
- **Chunking moves out of n8n into the app.** `ingestCandidate` returns a ready
  `chunks: string[]`; the n8n data-steward workflow stops calling its own
  `chunkText` and embeds the returned chunks directly. This centralizes all
  pre-embedding text handling (redact → format → chunk) in one testable place.
- **Dependency-free, hand-rolled** (no LangChain / text-splitter libs) — matches the
  `redact.ts` style and keeps the n8n bundle and app dependencies unchanged.
- **Chunk target stays ~1500 chars / ~200 overlap** — parity with today minimizes
  index churn and stays well within the embedding model's token limit; the change is
  *where* boundaries fall, not how big chunks are.
- **Recursive separator splitter** chosen over a section-aware two-pass + header-prefix
  approach: it captures section awareness cheaply (headers/blank lines are just the
  highest-priority split points) without fragile header-detection or prefix logic
  that would misfire on flat resumes or name lines.

## The module — `src/services/format.ts`

Two exported, pure functions. Both guard empty/null input without throwing, matching
the `if (!text) return text` style in `redact.ts`.

### `formatForEmbedding(text: string): string`

Light normalization, applied **after** redaction (so it also tidies the whitespace
that URL-stripping leaves behind). NFKC is already applied upstream by
`redactForEmbedding`, so this does not re-normalize.

- Strip per-line trailing whitespace.
- Collapse runs of 2+ spaces → a single space.
- En-dash `–` and em-dash `—` → `-`; curly quotes `‘ ’ “ ”` → straight `' "`.
  (Minimal, evidence-driven — only characters actually observed / cheaply mapped.)
- Collapse 3+ consecutive newlines → 2 (preserve single and double newlines as
  paragraph structure the chunker relies on).
- Trim the ends.
- Empty/null input → `''`.

### `chunkForEmbedding(text: string): string[]`

Recursive separator splitter with a priority hierarchy:

1. **Blank-line / ALL-CAPS-header boundaries** — split on `\n\s*\n`, and treat a line
   matching an ALL-CAPS header pattern (`^[A-Z][A-Z /&,-]{2,40}$`) as a hard boundary
   that starts a new unit, keeping the header attached to the content that follows it.
2. **Sentence boundaries** — split on `(?<=[.!?])\s+`.
3. **Word boundaries** — split on spaces.

Algorithm: greedily pack units into a chunk up to the **~1500-char target**; when
adding the next unit would exceed the target, emit the chunk and begin the next one
carrying a **~200-char overlap tail snapped to a unit boundary** (so overlaps are
never mid-word). If a single unit at the current level exceeds the target, descend to
the next finer separator for that unit only. A unit that is still oversized at the
word level (e.g. a pathological unbroken string) is hard-sliced as a last resort.

- Never cuts mid-word under normal input.
- Empty/null input → `[]`.

## Data flow / wiring

- **`ingestCandidate`** (`src/services/ingest.ts`): after redaction,
  `embedding_text = formatForEmbedding(redactForEmbedding(resume_text))`, and the
  return value gains `chunks: chunkForEmbedding(embedding_text)` alongside the
  existing `candidate_id` / `document_id` / `deduped` / `embedding_text`.
- **`n8n/workflows/src/data-steward.workflow.mjs`**: one line changes —
  `chunkText(resume_text)` → `ing.chunks`. The existing per-chunk `sha256` +
  embed-and-upsert loop is unchanged. `chunkText` in `helpers.js` becomes unused on
  this path (left in place; its removal is not part of this spec).
- `candidate_documents.parsed_text` is never modified — recruiters keep the full
  original text.

## Sequencing & coordination with the redaction spec

The redaction spec (`2026-07-24-pii-redaction-design.md`) is approved but not yet
implemented. It introduces `embedding_text = redactForEmbedding(resume_text)` on the
`ingestCandidate` return and changes the same data-steward line to consume it. This
spec composes on top of that: `formatForEmbedding` wraps `redactForEmbedding`'s
output, and the data-steward line's final form is `ing.chunks`. Land order:

1. Redaction spec (or land both together in one change).
2. This spec — adds `formatForEmbedding` + `chunkForEmbedding`, extends the return
   with `chunks`, and moves chunking off n8n.

Never land this before redaction: chunking unredacted text would still ship PII to
the vector store.

## Operational note — re-embedding

Changing chunk boundaries makes existing stored `embeddings` rows stale (their
`content` no longer matches what the new chunker produces). Existing candidates only
benefit after a re-embed via the existing `scripts/migration/backfill-embeddings.ts`.
This is an operational follow-up, not new code in this spec — called out so it isn't
forgotten during rollout.

## Testing

- New `src/services/format.test.ts` (Vitest):
  - `formatForEmbedding`: trailing whitespace, multi-space collapse, en/em-dash and
    curly-quote mapping, 3+ newline collapse (and preservation of single/double),
    null/empty input.
  - `chunkForEmbedding`: no mid-word cuts, respects header and blank-line boundaries,
    overlap present between adjacent chunks, oversize-unit fallback descends
    correctly, target size respected, empty input → `[]`.
- Update `src/services/ingest.test.ts` to assert the response includes `chunks`, that
  they are derived from the formatted+redacted text, and reconstruct to the expected
  content.
- Re-run `n8n/tests/data-steward.sh` locally after the workflow one-line change
  (`node n8n/build.mjs` + `bash n8n/apply.sh` first) to confirm the field change
  didn't break the existing functional flow.

## Known risks / tradeoffs

- **Normalization is deliberately minimal.** It maps only characters observed in real
  samples plus a few cheap, safe mappings. A future source with heavier artifacts
  would need this revisited — accepted, not pre-solved.
- **ALL-CAPS header detection is a heuristic.** A name line in all caps (e.g.
  `MANROSE SOHI`) is treated as a boundary too. This is harmless — it just starts a
  new chunk at a natural place — because headers are used only as split points, never
  prefixed onto or interpreted as section labels.
- **Re-embed required for existing data** (see operational note) — new behavior
  applies immediately to newly ingested candidates; existing vectors need the backfill
  to benefit.

## Out of scope

- General resume cleanup: boilerplate/EEO text, repeated headers/footers, page
  numbers, PDF-extraction repair (real JobDiva data shows none of these).
- Job-order text (employer-authored, not a candidate-PII/quality concern here).
- Redacting or modifying `candidate_documents.parsed_text`.
- Removing the now-unused `chunkText` helper from `n8n/workflows/src/helpers.js`.
- Changing chunk target size or overlap, or the embedding model/dimensions.
- The re-embed backfill run itself (operational rollout step, not implementation).
