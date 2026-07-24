# PII redaction for candidate resumes — Design

**Date:** 2026-07-24
**Status:** Design approved by Rick, not yet implemented
**Approach:** App-side TS module (`src/services/redact.ts`), n8n workflows consume
already-redacted fields via one-line changes each — no new n8n-side logic, no new
network round trips.
**Sequencing:** Must be designed and implemented **before** the already-approved
`docs/superpowers/specs/2026-07-24-n8n-staging-workflow-bringup-design.md` is
executed, per Rick's explicit decision — nothing should go to staging's live n8n
until this is in place.

## Goal

Candidate resume text is currently embedded (sent to Gemini's `embedContent` API)
and stored in the `embeddings.content` column, and separately sent whole to Gemini
for fit-scoring in Screening — all fully unredacted. This is not hypothetical
exposure: the 2026-07-22 live sourcing smoke test already ran this exact path
against real production JobDiva candidates. Redact PII from what leaves the
system (Gemini calls) and what lands in the searchable vector store, without
losing the recruiter-facing original resume record.

## Prior art found

Rick's other n8n workspace has a working, tested pattern for this in its
"Ingest Candidate Details" workflow (`Sanitize Resume` code node): regex-strips
email/phone/URLs unconditionally, and — as a second tier on top — fully
de-identifies (name + gendered pronouns) specifically for what an LLM sees, with
the LLM's system prompt explicitly told the text is de-identified so it never
infers identity even from what slips through. The LLM's own identity-field
outputs are discarded; real identity always comes from a structured source, never
re-derived from resume prose. This design ports the redaction *rules* from that
pattern but not its implementation layer (see below) or its general text-cleanup
logic (out of scope, see "Out of scope").

## Decisions made

- **Two storage tiers, not one.** `candidate_documents.parsed_text` (the
  recruiter-facing record in the app UI) keeps the full original text —
  recruiters need to actually read and contact candidates, and `candidates.email`
  / `candidates.phone` are already structured, unredacted columns today, so this
  changes nothing there. Redaction applies only to (a) what gets embedded into
  the searchable vector store, and (b) what's sent to Gemini for scoring.
- **Redaction logic lives in TypeScript** (`src/services/redact.ts`), not inline
  n8n Code-node JS. This repo already keeps real logic in `src/services/*.ts`
  (deep modules, e.g. `matching.ts`, `ingest.ts`) with n8n as thin dispatch; a TS
  module is unit-testable with the existing Jest suite (n8n-side JS has no
  equivalent — it's only covered by the functional `n8n/tests/*.sh` scripts), and
  avoids duplicating the same redaction code across two separate Code nodes.
  n8n workflows change one line each to consume new fields already-redacted by
  the app; no new network round trips (piggybacks on calls that already happen).
- **Name detection is deterministic, not inferred.** The reference pattern
  guesses at candidate names from context (DB fields when available, else a
  regex for a "Candidate Full Legal Name:" label line) because identity isn't
  always known yet at its pipeline stage. In this repo, `ingestCandidate`
  requires `full_name` up front and `getCandidateWithResume` always has the
  candidate row — the real name is always already known, so redaction can do a
  plain whole-word replace with no guessing and no stop-word list needed.
- **Scope is PII only**, not general resume cleanup. The reference pattern also
  strips EEO/boilerplate text, repeated headers/footers, and page numbers as
  part of the same node — deliberately not porting that here; it's a resume-
  quality concern, not a redaction concern, and would blur this spec's scope.
- **Job-order text is out of scope.** It's employer-authored, not candidate PII.

## Redaction rules

`src/services/redact.ts`, two exported functions:

```
redactForEmbedding(text: string): string
```
Normalizes the text (NFKC), replaces email addresses with `[EMAIL]`, replaces
phone numbers (US formats: `(555) 555-5555`, `555-555-5555`, `+1 555.555.5555`,
etc.) with `[PHONE]`, strips URLs (`http(s)://...` and bare `www....`) entirely.
This is the floor — applied to anything that reaches the vector store.

```
redactForLLM(text: string, fullName: string): string
```
Starts from `redactForEmbedding(text)`, then whole-word-replaces (case-
insensitive) every space-separated token of `fullName` (length ≥ 2) with
`[NAME]`, collapses repeated `[NAME]` tokens, and neutralizes gendered pronouns:
`she/he → they`, `her/his → their`, `him → them`, `hers → theirs`,
`herself/himself → themself`. This is what Gemini sees for scoring.

Both functions return `''`/pass through unchanged on empty or null input (no
throw) — matches the existing `if (!rawText)` guard style already used in
`n8n/workflows/src/helpers.js`'s `chunkText`.

## Data flow / wiring

- **`ingestCandidate`** (`src/services/ingest.ts`): after building
  `resume_text`, computes `embedding_text = resume_text ? redactForEmbedding(resume_text) : null`
  and adds it to the function's return value alongside the existing
  `candidate_id` / `document_id` / `deduped`.
  `n8n/workflows/src/data-steward.workflow.mjs` changes one line:
  `chunkText(resume_text)` → `chunkText(ing.embedding_text)`. Everything else in
  that workflow (dedup logic, decision proposal, orchestrator signal) is
  unchanged.
- **`getCandidateWithResume`** (`src/services/matching.ts`): when a resume
  document exists, computes
  `llm_text = redactForLLM(doc.parsed_text, cand.full_name)` and adds it to the
  returned `resume` object alongside the existing `document_id` / `parsed_text`.
  `n8n/workflows/src/screening.workflow.mjs` changes one line: the
  `{resume_text}` template substitution source changes from
  `cr.resume.parsed_text` → `cr.resume.llm_text`. Everything else in that
  workflow (scoring, decision proposals, outreach drafting) is unchanged.
- `candidate_documents.parsed_text` in the database is never modified by this
  change — it continues to store the full original text.

## Testing

- New `src/services/redact.test.ts` (Jest): email formats, US phone formats,
  bare and `www.`-prefixed URLs, multi-token names with punctuation, pronoun
  cases, and null/empty input for both functions.
- Update `src/services/ingest.test.ts` to assert `embedding_text` is present and
  correctly redacted on the response.
- Update the candidates-route/matching tests
  (`src/app/api/agent/candidates/[id]/route.test.ts` and/or a `matching.test.ts`
  if one exists) to assert `resume.llm_text` is present and correctly redacted.
- Re-run `n8n/tests/data-steward.sh` and `n8n/tests/sourcing-screening.sh`
  locally after the workflow-code changes (`node n8n/build.mjs` +
  `bash n8n/apply.sh` first) to confirm the field-name changes didn't break the
  existing functional flow.

## Known risks

- Over-redaction: a candidate whose name is also a common English word (e.g.
  "Mark") will have that word replaced with `[NAME]` wherever it appears in the
  LLM-facing text, including as an ordinary word. This is an inherent tradeoff
  of whole-word name matching, shared by the reference pattern — accepted, not a
  bug to fix here.
- Phone/email regex coverage is necessarily incomplete (e.g. non-US phone
  formats, obfuscated emails like "name at domain dot com") — same limitation as
  the reference pattern. Treated as a best-effort floor, not a guarantee; revisit
  if a real gap surfaces in practice.

## Out of scope

- General resume text cleanup (boilerplate/EEO text, repeated headers/footers,
  page numbers).
- Redacting `candidate_documents.parsed_text` itself (explicitly rejected by the
  two-tier decision above).
- Job-order text redaction.
- SSN/DOB/street-address detection — not present in current resume flows;
  revisit if that data starts appearing.
- The already-approved n8n staging bring-up
  (`docs/superpowers/specs/2026-07-24-n8n-staging-workflow-bringup-design.md`) —
  strictly sequenced after this work, not part of it.
