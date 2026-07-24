# Pre-embedding Formatting & Chunking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize and structure-aware-chunk candidate resume text after PII redaction and before embedding, so each stored vector represents a coherent unit instead of a mid-thought fragment.

**Architecture:** A new pure, dependency-free TS module `src/services/format.ts` exports `formatForEmbedding` (light character normalization) and `chunkForEmbedding` (recursive separator splitter). `ingestCandidate` composes them onto the existing redaction output and returns a ready `chunks: string[]`. The n8n data-steward workflow stops chunking locally and embeds the returned chunks.

**Tech Stack:** TypeScript, Vitest, n8n workflow SDK (`.mjs`). No new dependencies.

## Global Constraints

- No new npm dependencies — hand-rolled like `src/services/redact.ts`.
- Pure functions guard empty input without throwing (mirror `redact.ts`: `if (!text) return ...`).
- Chunk target **1500 chars**, overlap **200 chars** (parity with today's `chunkText`; do not change).
- Redaction runs first; formatting composes on its output: `formatForEmbedding(redactForEmbedding(resume_text))`.
- Never modify `candidate_documents.parsed_text`.
- Tests are Vitest (`import { describe, it, expect } from 'vitest'`). Pure-unit tests need no DB; `ingest.test.ts` is a DB integration test needing `DATABASE_URL`.

---

### Task 1: `formatForEmbedding` — light normalization

**Files:**
- Create: `src/services/format.ts`
- Test: `src/services/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function formatForEmbedding(text: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/services/format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatForEmbedding } from './format';

describe('formatForEmbedding', () => {
  it('strips per-line trailing whitespace', () => {
    expect(formatForEmbedding('Senior Dev   \nReact   ')).toBe('Senior Dev\nReact');
  });

  it('collapses runs of 2+ spaces to one', () => {
    expect(formatForEmbedding('React    Developer')).toBe('React Developer');
  });

  it('maps en/em dashes to hyphen and curly quotes to straight', () => {
    expect(formatForEmbedding('2020 – 2024 “React” ‘dev’'))
      .toBe('2020 - 2024 "React" \'dev\'');
  });

  it('collapses 3+ newlines to 2 but preserves single and double newlines', () => {
    expect(formatForEmbedding('A\n\n\n\nB')).toBe('A\n\nB');
    expect(formatForEmbedding('A\n\nB\nC')).toBe('A\n\nB\nC');
  });

  it('tidies the double space that URL-stripping leaves behind', () => {
    expect(formatForEmbedding('Portfolio:  and ')).toBe('Portfolio: and');
  });

  it('returns empty string for empty input without throwing', () => {
    expect(formatForEmbedding('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/format.test.ts`
Expected: FAIL — cannot find module `./format` / `formatForEmbedding is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/format.ts` with:

```typescript
/** Light normalization applied AFTER redaction, before chunking. NFKC is already
 * applied upstream by redactForEmbedding, so it is not repeated here. */
export function formatForEmbedding(text: string): string {
  if (!text) return text;
  return text
    .replace(/[–—]/g, '-')       // en/em dash -> hyphen
    .replace(/[‘’]/g, "'")        // curly single quotes -> '
    .replace(/[“”]/g, '"')        // curly double quotes -> "
    .replace(/[ \t]+$/gm, '')               // strip per-line trailing whitespace
    .replace(/ {2,}/g, ' ')                 // collapse 2+ spaces -> 1
    .replace(/\n{3,}/g, '\n\n')             // collapse 3+ newlines -> paragraph break
    .trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/format.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/format.ts src/services/format.test.ts
git commit -m "feat: add formatForEmbedding text normalization"
```

---

### Task 2: `chunkForEmbedding` — recursive separator splitter

**Files:**
- Modify: `src/services/format.ts` (add function + helpers)
- Test: `src/services/format.test.ts` (add describe block)

**Interfaces:**
- Consumes: nothing (independent of Task 1's function).
- Produces: `export function chunkForEmbedding(text: string): string[]`

- [ ] **Step 1: Write the failing test**

Append to `src/services/format.test.ts`:

```typescript
import { chunkForEmbedding } from './format';

describe('chunkForEmbedding', () => {
  it('returns an empty array for empty input', () => {
    expect(chunkForEmbedding('')).toEqual([]);
  });

  it('returns a single chunk when the text fits under the target', () => {
    const t = 'A short resume under the target size.';
    expect(chunkForEmbedding(t)).toEqual([t]);
  });

  it('splits oversized text into multiple chunks without cutting mid-word', () => {
    const text = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkForEmbedding(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(1700);   // target 1500 + overlap 200
      expect(c).toMatch(/^word\d+/);                 // starts at a whole token
      expect(c.trimEnd()).toMatch(/word\d+$/);       // ends at a whole token
    }
  });

  it('carries word-boundary overlap between adjacent prose chunks', () => {
    const text = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkForEmbedding(text);
    const firstTokenOfSecond = chunks[1].split(' ')[0];
    expect(chunks[0].includes(firstTokenOfSecond)).toBe(true);
  });

  it('starts a new chunk at an ALL-CAPS section header, with no cross-section overlap', () => {
    const summary = 'Summary line. '.repeat(80);
    const experience = 'Did work. '.repeat(80);
    const text = `${summary}\nPROFESSIONAL EXPERIENCE\n${experience}`;
    const chunks = chunkForEmbedding(text);
    const headerChunk = chunks.find((c) => c.includes('PROFESSIONAL EXPERIENCE'));
    expect(headerChunk).toBeDefined();
    expect(headerChunk!.trimStart().startsWith('PROFESSIONAL EXPERIENCE')).toBe(true);
  });

  it('hard-splits a single unit longer than the target as a last resort', () => {
    const chunks = chunkForEmbedding('x'.repeat(4000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1700)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/format.test.ts`
Expected: FAIL — `chunkForEmbedding is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/services/format.ts`:

```typescript
const TARGET = 1500;
const OVERLAP = 200;
const HEADER = '[A-Z][A-Z /&,-]{2,40}';
const SEPARATORS = ['\n\n', '\n', '. ', ' '];

/** Structure-aware chunker: prefers section/paragraph/sentence boundaries and
 * never cuts mid-word under normal input. Empty input -> []. */
export function chunkForEmbedding(text: string): string[] {
  if (!text) return [];
  // Promote ALL-CAPS header lines to paragraph boundaries so a section header
  // prefers to start a new chunk.
  const prepared = text.replace(
    new RegExp(`([^\\n])\\n(${HEADER})(?=\\n)`, 'g'),
    '$1\n\n$2',
  );
  return mergeUnits(recursiveSplit(prepared, SEPARATORS));
}

/** Split text into units each <= TARGET, descending the separator hierarchy only
 * for pieces that are still too big. The separator is re-attached to each piece
 * (except the last) so concatenating units round-trips the original text. */
function recursiveSplit(text: string, seps: string[]): string[] {
  if (text.length <= TARGET) return text ? [text] : [];
  const [sep, ...rest] = seps;
  if (sep === undefined) {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += TARGET) out.push(text.slice(i, i + TARGET));
    return out;
  }
  const parts = text.split(sep);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const piece = i < parts.length - 1 ? parts[i] + sep : parts[i];
    if (!piece) continue;
    if (piece.length <= TARGET) out.push(piece);
    else out.push(...recursiveSplit(piece, rest));
  }
  return out;
}

/** Greedily pack units up to TARGET. On overflow, emit the chunk and carry a
 * word-boundary overlap tail into the next one — except across a paragraph/header
 * boundary (a unit that ended with a blank line), where overlap is dropped so the
 * next section starts clean. */
function mergeUnits(units: string[]): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const u of units) {
    if (cur && cur.length + u.length > TARGET) {
      chunks.push(cur);
      cur = (cur.endsWith('\n\n') ? '' : tail(cur, OVERLAP)) + u;
    } else {
      cur += u;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Last <= n chars of s, trimmed forward to the next word boundary so the overlap
 * never begins mid-word. */
function tail(s: string, n: number): string {
  if (s.length <= n) return s;
  const slice = s.slice(s.length - n);
  const sp = slice.indexOf(' ');
  return sp === -1 ? slice : slice.slice(sp + 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/format.test.ts`
Expected: PASS (all `formatForEmbedding` + `chunkForEmbedding` tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/format.ts src/services/format.test.ts
git commit -m "feat: add chunkForEmbedding recursive splitter"
```

---

### Task 3: Wire into ingest + switch n8n to returned chunks

**Files:**
- Modify: `src/services/ingest.ts` (import; `embedding_text` line ~92; return object; return type on ~20-21)
- Modify: `src/services/ingest.test.ts` (add assertion)
- Modify: `n8n/workflows/src/data-steward.workflow.mjs` (one line)
- Test: `src/services/ingest.test.ts`

**Interfaces:**
- Consumes: `formatForEmbedding`, `chunkForEmbedding` from `./format` (Tasks 1-2); existing `redactForEmbedding` from `./redact`.
- Produces: `ingestCandidate` return gains `chunks: string[]`. Full return type: `{ candidate_id: string; document_id: string | null; deduped: boolean; embedding_text: string | null; chunks: string[] }`.

- [ ] **Step 1: Write the failing test**

In `src/services/ingest.test.ts`, add this test inside the `describe('ingestCandidate', ...)` block (it reuses the existing `orgId` fixture):

```typescript
  it('returns structure-aware chunks derived from the redacted+formatted text', async () => {
    const r = await ingestCandidate({
      org_id: orgId, full_name: 'Chunk Target',
      email: `chunk-${Date.now()}@example.com`,
      resume_text: 'Reach Chunk Target at chunk@example.com.\n\nPROFESSIONAL EXPERIENCE\nBuilt things.',
    });
    expect(Array.isArray(r.chunks)).toBe(true);
    expect(r.chunks.length).toBeGreaterThan(0);
    // redaction still applied before chunking
    expect(r.chunks.join(' ')).toContain('[EMAIL]');
    expect(r.chunks.join(' ')).not.toContain('chunk@example.com');
  });

  it('returns an empty chunks array when there is no resume_text', async () => {
    const r = await ingestCandidate({
      org_id: orgId, full_name: 'No Resume Chunks',
      email: `no-chunks-${Date.now()}@example.com`,
    });
    expect(r.chunks).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/ingest.test.ts`
Expected: FAIL — `r.chunks` is `undefined` (`Array.isArray(undefined)` is false / `.length` throws).

- [ ] **Step 3: Write minimal implementation**

In `src/services/ingest.ts`:

a) Extend the import on line 5:

```typescript
import { redactForEmbedding } from './redact';
import { formatForEmbedding, chunkForEmbedding } from './format';
```

b) Update the return-type annotation on the function signature (lines ~19-21) to add `chunks`:

```typescript
export async function ingestCandidate(input: unknown): Promise<{
  candidate_id: string; document_id: string | null; deduped: boolean;
  embedding_text: string | null; chunks: string[];
}> {
```

c) Replace the `embedding_text` computation and return (lines ~92-93):

```typescript
    const embedding_text = p.resume_text
      ? formatForEmbedding(redactForEmbedding(p.resume_text))
      : null;
    const chunks = embedding_text ? chunkForEmbedding(embedding_text) : [];
    return { candidate_id: candidateId, document_id: documentId, deduped, embedding_text, chunks };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/ingest.test.ts`
Expected: PASS (existing tests plus the two new ones).

- [ ] **Step 5: Switch the n8n workflow to the returned chunks**

In `n8n/workflows/src/data-steward.workflow.mjs`, change the chunk line inside the `if (resume_text && ing.document_id)` block:

```javascript
  const chunks = ing.chunks;
```

(was `const chunks = chunkText(ing.embedding_text);`). The `sha256`/`embed` loop below it is unchanged.

- [ ] **Step 6: Rebuild the n8n workflow bundle**

Run: `node n8n/build.mjs`
Expected: builds without error (regenerates the compiled workflow that `n8n/apply.sh` deploys).

- [ ] **Step 7: Run the full unit suite**

Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 8: Commit**

```bash
git add src/services/ingest.ts src/services/ingest.test.ts n8n/workflows/src/data-steward.workflow.mjs n8n/workflows/compiled
git commit -m "feat: return structure-aware chunks from ingest; n8n embeds them"
```

---

## Post-implementation (operational, not code)

- **Re-embed existing candidates** so stored vectors reflect the new chunk boundaries: run `scripts/migration/backfill-embeddings.ts`. This is a rollout step, tracked separately from this plan.
- **Functional n8n check** (optional, needs a running n8n + staging env): `bash n8n/apply.sh` then `bash n8n/tests/data-steward.sh` to confirm the field change didn't break the live flow.

## Self-Review

- **Spec coverage:** `formatForEmbedding` (Task 1) ✓; `chunkForEmbedding` recursive splitter with header/blank/sentence/word hierarchy + overlap (Task 2) ✓; ingest returns `chunks`, n8n consumes them (Task 3) ✓; testing (all tasks) ✓; re-embed operational note ✓; out-of-scope items untouched ✓.
- **Placeholders:** none — all steps carry real code and exact commands.
- **Type consistency:** `formatForEmbedding(text: string): string`, `chunkForEmbedding(text: string): string[]` used identically in Task 3; ingest return type extended consistently with the `chunks: string[]` produced.
