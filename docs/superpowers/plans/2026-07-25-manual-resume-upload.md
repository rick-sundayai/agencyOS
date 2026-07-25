# Manual Resume Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recruiter upload a single PDF/DOCX resume from a global "Add candidate" action, auto-extract the candidate's fields for review, and on confirm ingest + embed the candidate into the pool with the original file retained in GCS.

**Architecture:** Two in-app Next.js routes. `POST /api/candidates/upload` parses the file, extracts fields with Gemini, stages the original + parsed text in GCS, and returns a pre-filled draft. `POST /api/candidates/confirm` re-reads the staged text, calls the existing `ingestCandidate`, promotes the staged file to a permanent GCS key, then embeds the chunks in-app via `embed.ts`. Ingest and embedding are separate commits so a failed embed never loses the candidate. n8n is not involved.

**Tech Stack:** Next.js 16 (App Router, route handlers), TypeScript, Drizzle ORM + Postgres, Zod v4, next-auth (session), `@google-cloud/storage`, `mammoth` (DOCX), `pdf-parse` (PDF), Gemini `generateContent`, Vitest against a real test Postgres.

## Global Constraints

- **Read `node_modules/next/dist/docs/` before writing route/handler code** — this Next.js has breaking changes vs training data (per `AGENTS.md`).
- **Formats:** PDF + DOCX only. Legacy `.doc` is unsupported and must be rejected.
- **PII:** raw resume text and field-extraction stay server-side; the browser receives only pre-filled fields + a short preview. Embedding continues to go through `redactForEmbedding` (already inside `ingestCandidate`'s output — vectors never receive PII). Do not send raw text to the vector store.
- **Auth:** these are recruiter-facing routes — use session auth via `auth()` from `src/lib/auth.ts` (NOT `requireAgentKey`, which is for `/api/agent/*`).
- **Org scoping:** every DB read/write and every GCS key is scoped by `session.user.org_id`. Staging keys live under `staging/<org_id>/…`.
- **Embedding dim:** 3072, model `gemini-embedding-001` (already fixed in `embed.ts`). Reuse `defaultEmbedder()` — do not re-declare.
- **Injectable-deps pattern:** follow `embed.ts` — services take an injected function/dep with a `defaultX()` factory for production, so tests never hit real GCS/Gemini/PDF libs.
- **Tests:** Vitest. DB-touching suites use `createFixtureOrg()` from `src/test/fixtures.ts` and a `postgres` client for assertions (see `src/services/ingest.test.ts`). Run with `npm test`.

---

### Task 1: Add `embedding_status` to `candidate_documents`

**Files:**
- Modify: `src/db/schema/ats.ts:35-44`
- Create (generated): `drizzle/0010_*.sql`
- Test: `src/services/ingest.test.ts` (add one test)

**Interfaces:**
- Produces: `candidate_documents.embedding_status` column — `text`, NOT NULL, default `'pending'`, values `pending | embedded | failed`. Later tasks read/write it.

- [ ] **Step 1: Write the failing test**

Add to `src/services/ingest.test.ts` inside the `describe('ingestCandidate', …)` block:

```ts
  it('defaults a new resume document to embedding_status = pending', async () => {
    const r = await ingestCandidate({
      org_id: orgId, full_name: 'Status Default',
      email: `status-${Date.now()}@example.com`, resume_text: 'some resume text',
    });
    const [doc] = await sql`
      select embedding_status from candidate_documents where id = ${r.document_id}`;
    expect(doc.embedding_status).toBe('pending');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/ingest.test.ts`
Expected: FAIL — column `embedding_status` does not exist.

- [ ] **Step 3: Add the column to the schema**

In `src/db/schema/ats.ts`, add to the `candidate_documents` table definition (after `parsed_text`):

```ts
  parsed_text: text('parsed_text'),
  embedding_status: text('embedding_status').notNull().default('pending'),
  version: integer('version').notNull().default(1),
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `drizzle/0010_*.sql` containing `ALTER TABLE "candidate_documents" ADD COLUMN "embedding_status" text DEFAULT 'pending' NOT NULL;`. The vitest global setup migrates the test DB automatically on next run.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/services/ingest.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/ats.ts drizzle/ src/services/ingest.test.ts
git commit -m "feat: add embedding_status to candidate_documents"
```

---

### Task 2: `extractResumeText` service

**Files:**
- Create: `src/services/resume-extract.ts`
- Test: `src/services/resume-extract.test.ts`
- Modify: `package.json` (add `mammoth`, `pdf-parse`)

**Interfaces:**
- Produces:
  ```ts
  export type ResumeFile = { bytes: Uint8Array; mime: string; filename: string };
  export type TextParser = (bytes: Uint8Array) => Promise<string>;
  export type Parsers = { pdf: TextParser; docx: TextParser };
  export class UnsupportedResumeError extends Error {}
  export class EmptyResumeError extends Error {}
  export function extractResumeText(file: ResumeFile, parsers?: Parsers): Promise<string>;
  export const defaultParsers: Parsers;
  ```
- Consumes (default parsers): `mammoth`, `pdf-parse`.

- [ ] **Step 1: Add the parsing dependencies**

Run: `npm install mammoth pdf-parse && npm install -D @types/pdf-parse`
Expected: all three appear in `package.json`.

- [ ] **Step 2: Write the failing test**

Create `src/services/resume-extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  extractResumeText, UnsupportedResumeError, EmptyResumeError, type Parsers,
} from './resume-extract';

const bytes = new Uint8Array([1, 2, 3]);
const fakeParsers: Parsers = {
  pdf: async () => 'PDF RESUME TEXT',
  docx: async () => 'DOCX RESUME TEXT',
};

describe('extractResumeText', () => {
  it('routes application/pdf to the pdf parser', async () => {
    const text = await extractResumeText(
      { bytes, mime: 'application/pdf', filename: 'r.pdf' }, fakeParsers);
    expect(text).toBe('PDF RESUME TEXT');
  });

  it('routes a .docx to the docx parser', async () => {
    const text = await extractResumeText(
      { bytes,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'r.docx' }, fakeParsers);
    expect(text).toBe('DOCX RESUME TEXT');
  });

  it('rejects an unsupported type (e.g. legacy .doc)', async () => {
    await expect(extractResumeText(
      { bytes, mime: 'application/msword', filename: 'r.doc' }, fakeParsers),
    ).rejects.toBeInstanceOf(UnsupportedResumeError);
  });

  it('rejects a file that parses to empty/whitespace text', async () => {
    const emptyParsers: Parsers = { pdf: async () => '   \n ', docx: async () => '' };
    await expect(extractResumeText(
      { bytes, mime: 'application/pdf', filename: 'r.pdf' }, emptyParsers),
    ).rejects.toBeInstanceOf(EmptyResumeError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/services/resume-extract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `src/services/resume-extract.ts`:

```ts
export type ResumeFile = { bytes: Uint8Array; mime: string; filename: string };
export type TextParser = (bytes: Uint8Array) => Promise<string>;
export type Parsers = { pdf: TextParser; docx: TextParser };

export class UnsupportedResumeError extends Error {
  constructor(msg = 'Unsupported resume type. Upload a PDF or Word (.docx) file.') {
    super(msg);
    this.name = 'UnsupportedResumeError';
  }
}
export class EmptyResumeError extends Error {
  constructor(msg = "Couldn't read any text from that file. It may be scanned or empty.") {
    super(msg);
    this.name = 'EmptyResumeError';
  }
}

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function kind(file: ResumeFile): 'pdf' | 'docx' {
  const name = file.filename.toLowerCase();
  if (file.mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.mime === DOCX_MIME || name.endsWith('.docx')) return 'docx';
  throw new UnsupportedResumeError();
}

export async function extractResumeText(
  file: ResumeFile, parsers: Parsers = defaultParsers,
): Promise<string> {
  const parser = kind(file) === 'pdf' ? parsers.pdf : parsers.docx;
  const text = (await parser(file.bytes)).trim();
  if (!text) throw new EmptyResumeError();
  return text;
}

// Dynamic imports keep these Node-only libs out of any client bundle and mirror the
// lazy-import pattern in embed.ts. pdf-parse's real entry is its lib file, not index.
export const defaultParsers: Parsers = {
  pdf: async (bytes) => {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default as
      (b: Buffer) => Promise<{ text: string }>;
    return (await pdfParse(Buffer.from(bytes))).text;
  },
  docx: async (bytes) => {
    const mammoth = await import('mammoth');
    return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/services/resume-extract.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/resume-extract.ts src/services/resume-extract.test.ts package.json package-lock.json
git commit -m "feat: add extractResumeText (PDF/DOCX -> text)"
```

---

### Task 3: `extractCandidateFields` service

**Files:**
- Create: `src/services/resume-fields.ts`
- Test: `src/services/resume-fields.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PrefilledFieldsSchema: z.ZodType<PrefilledFields>;
  export type PrefilledFields = {
    full_name: string | null; email: string | null; phone: string | null;
    current_title: string | null; location: string | null;
  };
  export type CompleteFn = (prompt: string) => Promise<string>;
  export function extractCandidateFields(text: string, complete?: CompleteFn): Promise<PrefilledFields>;
  export function defaultCompleter(): CompleteFn;
  ```
- Contract: NEVER throws on bad model output — returns all-null fields instead.

- [ ] **Step 1: Write the failing test**

Create `src/services/resume-fields.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractCandidateFields } from './resume-fields';

describe('extractCandidateFields', () => {
  it('parses a well-formed JSON completion into fields', async () => {
    const complete = async () => JSON.stringify({
      full_name: 'Ada Lovelace', email: 'ada@example.com', phone: '555-1234',
      current_title: 'Engineer', location: 'London',
    });
    const f = await extractCandidateFields('resume text', complete);
    expect(f.full_name).toBe('Ada Lovelace');
    expect(f.email).toBe('ada@example.com');
    expect(f.location).toBe('London');
  });

  it('tolerates JSON wrapped in markdown fences', async () => {
    const complete = async () =>
      '```json\n{"full_name":"Bo","email":null,"phone":null,' +
      '"current_title":null,"location":null}\n```';
    const f = await extractCandidateFields('x', complete);
    expect(f.full_name).toBe('Bo');
    expect(f.email).toBeNull();
  });

  it('returns all-null fields (never throws) on unparseable output', async () => {
    const complete = async () => 'I could not find any fields, sorry!';
    const f = await extractCandidateFields('x', complete);
    expect(f).toEqual({
      full_name: null, email: null, phone: null, current_title: null, location: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/resume-fields.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/services/resume-fields.ts`:

```ts
import { z } from 'zod';

export const PrefilledFieldsSchema = z.strictObject({
  full_name: z.string().min(1).nullable().catch(null),
  email: z.string().min(1).nullable().catch(null),
  phone: z.string().min(1).nullable().catch(null),
  current_title: z.string().min(1).nullable().catch(null),
  location: z.string().min(1).nullable().catch(null),
});
export type PrefilledFields = z.infer<typeof PrefilledFieldsSchema>;

const ALL_NULL: PrefilledFields = {
  full_name: null, email: null, phone: null, current_title: null, location: null,
};

export type CompleteFn = (prompt: string) => Promise<string>;

const PROMPT = (text: string) =>
  `Extract the candidate's contact and headline fields from this resume. ` +
  `Respond with ONLY a JSON object with exactly these keys: ` +
  `full_name, email, phone, current_title, location. ` +
  `Use null for any field you cannot find. Do not invent values.\n\nRESUME:\n${text}`;

/** Strip ```json fences and grab the first {...} block, so minor formatting from the
 * model can't break extraction. */
function coerceJson(raw: string): unknown {
  const fenced = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(fenced.slice(start, end + 1)); } catch { return null; }
}

export async function extractCandidateFields(
  text: string, complete: CompleteFn = defaultCompleter(),
): Promise<PrefilledFields> {
  let raw: string;
  try { raw = await complete(PROMPT(text)); } catch { return { ...ALL_NULL }; }
  const parsed = PrefilledFieldsSchema.safeParse(coerceJson(raw));
  return parsed.success ? parsed.data : { ...ALL_NULL };
}

const MODEL = 'gemini-2.5-flash';

export function defaultCompleter(): CompleteFn {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('resume-fields: set GEMINI_API_KEY');
  return async (prompt: string) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
      },
    );
    if (!res.ok) throw new Error(`gemini generateContent failed: ${res.status}`);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/resume-fields.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/resume-fields.ts src/services/resume-fields.test.ts
git commit -m "feat: add extractCandidateFields (Gemini resume field extraction)"
```

---

### Task 4: GCS object-store adapter

**Files:**
- Create: `src/services/storage.ts`
- Test: `src/services/storage.test.ts`
- Modify: `package.json` (add `@google-cloud/storage`), `.env.example`

**Interfaces:**
- Produces:
  ```ts
  export type ObjectStore = {
    put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
    getText(key: string): Promise<string>;
    move(fromKey: string, toKey: string): Promise<void>;
    signedReadUrl(key: string, downloadName?: string): Promise<string>;
  };
  export type BucketLike = { /* minimal @google-cloud/storage Bucket surface */ };
  export function makeGcsStore(bucket: BucketLike): ObjectStore;
  export function defaultStore(): ObjectStore;
  ```

- [ ] **Step 1: Add the dependency and env var**

Run: `npm install @google-cloud/storage`
Then add to `.env.example`:

```
# GCS bucket holding uploaded resume files (manual-upload path)
GCS_RESUME_BUCKET=agencyos-resumes-staging
```

- [ ] **Step 2: Write the failing test**

Create `src/services/storage.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { makeGcsStore, type BucketLike } from './storage';

function fakeBucket() {
  const save = vi.fn(async () => {});
  const download = vi.fn(async () => [Buffer.from('staged text')]);
  const copy = vi.fn(async () => {});
  const del = vi.fn(async () => {});
  const getSignedUrl = vi.fn(async () => ['https://signed.example/x']);
  const file = vi.fn((key: string) => ({ save, download, copy, delete: del, getSignedUrl, name: key }));
  return { bucket: { file } as unknown as BucketLike, save, download, copy, del, getSignedUrl, file };
}

describe('makeGcsStore', () => {
  it('put() saves bytes with the content type', async () => {
    const f = fakeBucket();
    await makeGcsStore(f.bucket).put('staging/o/d', new Uint8Array([1]), 'application/pdf');
    expect(f.file).toHaveBeenCalledWith('staging/o/d');
    expect(f.save).toHaveBeenCalledWith(expect.any(Buffer),
      { contentType: 'application/pdf', resumable: false });
  });

  it('getText() downloads and returns UTF-8', async () => {
    const f = fakeBucket();
    expect(await makeGcsStore(f.bucket).getText('staging/o/d.txt')).toBe('staged text');
  });

  it('move() copies to the destination then deletes the source', async () => {
    const f = fakeBucket();
    await makeGcsStore(f.bucket).move('staging/o/d', 'resumes/o/c/doc');
    expect(f.copy).toHaveBeenCalled();
    expect(f.del).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/services/storage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `src/services/storage.ts`:

```ts
export type ObjectStore = {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getText(key: string): Promise<string>;
  move(fromKey: string, toKey: string): Promise<void>;
  signedReadUrl(key: string, downloadName?: string): Promise<string>;
};

// Minimal surface of a @google-cloud/storage Bucket that this adapter uses.
export type FileLike = {
  name: string;
  save(data: Buffer, opts: { contentType: string; resumable: boolean }): Promise<unknown>;
  download(): Promise<[Buffer]>;
  copy(dest: FileLike): Promise<unknown>;
  delete(): Promise<unknown>;
  getSignedUrl(opts: Record<string, unknown>): Promise<[string]>;
};
export type BucketLike = { file(key: string): FileLike };

export function makeGcsStore(bucket: BucketLike): ObjectStore {
  return {
    async put(key, bytes, contentType) {
      await bucket.file(key).save(Buffer.from(bytes), { contentType, resumable: false });
    },
    async getText(key) {
      const [buf] = await bucket.file(key).download();
      return buf.toString('utf-8');
    },
    async move(fromKey, toKey) {
      const src = bucket.file(fromKey);
      await src.copy(bucket.file(toKey));
      await src.delete();
    },
    async signedReadUrl(key, downloadName) {
      const [url] = await bucket.file(key).getSignedUrl({
        version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000,
        ...(downloadName
          ? { responseDisposition: `attachment; filename="${downloadName}"` }
          : {}),
      });
      return url;
    },
  };
}

export function defaultStore(): ObjectStore {
  const name = process.env.GCS_RESUME_BUCKET;
  if (!name) throw new Error('storage: set GCS_RESUME_BUCKET');
  // Lazy import so the SDK never enters a client bundle (mirrors embed.ts).
  // ADC provides credentials on Cloud Run, matching how embed.ts's Vertex path authenticates.
  let bucketPromise: Promise<BucketLike> | null = null;
  const getBucket = () => (bucketPromise ??= (async () => {
    const { Storage } = await import('@google-cloud/storage');
    return new Storage().bucket(name) as unknown as BucketLike;
  })());
  return {
    async put(k, b, c) { return makeGcsStore(await getBucket()).put(k, b, c); },
    async getText(k) { return makeGcsStore(await getBucket()).getText(k); },
    async move(f, t) { return makeGcsStore(await getBucket()).move(f, t); },
    async signedReadUrl(k, d) { return makeGcsStore(await getBucket()).signedReadUrl(k, d); },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/services/storage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/storage.ts src/services/storage.test.ts package.json package-lock.json .env.example
git commit -m "feat: add GCS object-store adapter for resume files"
```

---

### Task 5: `prepareCandidateDraft` service

**Files:**
- Create: `src/services/candidate-drafts.ts`
- Test: `src/services/candidate-drafts.test.ts`

**Interfaces:**
- Consumes: `ObjectStore` (Task 4), `ResumeFile` (Task 2), `PrefilledFields` (Task 3).
- Produces:
  ```ts
  export type DraftDeps = {
    store: ObjectStore;
    extractText: (f: ResumeFile) => Promise<string>;
    extractFields: (text: string) => Promise<PrefilledFields>;
    newId: () => string;
  };
  export function prepareCandidateDraft(
    orgId: string, file: ResumeFile, deps: DraftDeps,
  ): Promise<{ draft_id: string; fields: PrefilledFields; preview: string }>;
  export function stagingKey(orgId: string, draftId: string): string;      // `staging/<org>/<draft>`
  export function stagingTextKey(orgId: string, draftId: string): string;  // `staging/<org>/<draft>.txt`
  ```

- [ ] **Step 1: Write the failing test**

Create `src/services/candidate-drafts.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { prepareCandidateDraft, stagingKey, stagingTextKey } from './candidate-drafts';
import type { ObjectStore } from './storage';

function fakeStore(): ObjectStore & { puts: Array<[string, string]> } {
  const puts: Array<[string, string]> = [];
  return {
    puts,
    async put(key, _b, contentType) { puts.push([key, contentType]); },
    async getText() { return ''; },
    async move() {},
    async signedReadUrl() { return ''; },
  };
}

describe('prepareCandidateDraft', () => {
  it('extracts, stages the file + text, and returns pre-filled fields', async () => {
    const store = fakeStore();
    const out = await prepareCandidateDraft(
      'org-1',
      { bytes: new Uint8Array([1]), mime: 'application/pdf', filename: 'r.pdf' },
      {
        store,
        extractText: async () => 'FULL RESUME TEXT',
        extractFields: async () => ({
          full_name: 'Ada', email: null, phone: null, current_title: null, location: null,
        }),
        newId: () => 'draft-123',
      },
    );
    expect(out.draft_id).toBe('draft-123');
    expect(out.fields.full_name).toBe('Ada');
    expect(out.preview).toContain('FULL RESUME TEXT');
    expect(store.puts).toContainEqual([stagingKey('org-1', 'draft-123'), 'application/pdf']);
    expect(store.puts).toContainEqual([stagingTextKey('org-1', 'draft-123'), 'text/plain']);
  });

  it('propagates extractor errors without staging anything', async () => {
    const store = fakeStore();
    await expect(prepareCandidateDraft(
      'org-1',
      { bytes: new Uint8Array([1]), mime: 'application/pdf', filename: 'r.pdf' },
      { store, extractText: async () => { throw new Error('bad pdf'); },
        extractFields: async () => ({ full_name: null, email: null, phone: null,
          current_title: null, location: null }), newId: () => 'd' },
    )).rejects.toThrow('bad pdf');
    expect(store.puts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/candidate-drafts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/services/candidate-drafts.ts`:

```ts
import type { ObjectStore } from './storage';
import type { ResumeFile } from './resume-extract';
import type { PrefilledFields } from './resume-fields';

export const stagingKey = (orgId: string, draftId: string) =>
  `staging/${orgId}/${draftId}`;
export const stagingTextKey = (orgId: string, draftId: string) =>
  `staging/${orgId}/${draftId}.txt`;

export type DraftDeps = {
  store: ObjectStore;
  extractText: (f: ResumeFile) => Promise<string>;
  extractFields: (text: string) => Promise<PrefilledFields>;
  newId: () => string;
};

export async function prepareCandidateDraft(
  orgId: string, file: ResumeFile, deps: DraftDeps,
): Promise<{ draft_id: string; fields: PrefilledFields; preview: string }> {
  const text = await deps.extractText(file);          // throws before any staging on bad file
  const fields = await deps.extractFields(text);
  const draftId = deps.newId();
  await deps.store.put(stagingKey(orgId, draftId), file.bytes, file.mime);
  await deps.store.put(
    stagingTextKey(orgId, draftId), new TextEncoder().encode(text), 'text/plain');
  return { draft_id: draftId, fields, preview: text.slice(0, 500) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/candidate-drafts.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/candidate-drafts.ts src/services/candidate-drafts.test.ts
git commit -m "feat: add prepareCandidateDraft (parse + stage + prefill)"
```

---

### Task 6: `confirmCandidateDraft` service

**Files:**
- Modify: `src/services/candidate-drafts.ts`
- Test: `src/services/candidate-drafts.confirm.test.ts`

**Interfaces:**
- Consumes: `ObjectStore`, `EmbedFn` (from `./embed`), `ingestCandidate` + `upsertEmbeddings` (from `./ingest`), `PrefilledFields`, `stagingKey`/`stagingTextKey`.
- Produces:
  ```ts
  export type ConfirmFields = {
    full_name: string; email: string | null; phone: string | null;
    current_title: string | null; location: string | null;
  };
  export type ConfirmDeps = { store: ObjectStore; embed: EmbedFn };
  export function confirmCandidateDraft(
    orgId: string, draftId: string, fields: ConfirmFields, deps: ConfirmDeps,
  ): Promise<{ candidate_id: string; document_id: string | null;
               embedding_status: 'embedded' | 'failed' | 'pending' }>;
  export function permanentKey(orgId: string, candidateId: string, documentId: string): string;
  ```
- Behavior: ingest first (committed), then promote file + embed as a **separate** best-effort step; a thrown embed sets `embedding_status = 'failed'` but still returns the candidate.

- [ ] **Step 1: Write the failing test**

Create `src/services/candidate-drafts.confirm.test.ts`:

```ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../lib/env';
import { createFixtureOrg } from '../test/fixtures';
import { confirmCandidateDraft, permanentKey } from './candidate-drafts';
import type { ObjectStore } from './storage';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;
beforeAll(async () => { orgId = await createFixtureOrg(); });

function storeWithText(text: string): ObjectStore & { moves: Array<[string, string]> } {
  const moves: Array<[string, string]> = [];
  return {
    moves,
    async put() {},
    async getText() { return text; },
    async move(f, t) { moves.push([f, t]); },
    async signedReadUrl() { return ''; },
  };
}
const vec = () => { const v = new Array(3072).fill(0); v[0] = 1; return v; };

describe('confirmCandidateDraft', () => {
  it('ingests, promotes the file, embeds, and marks embedded', async () => {
    const store = storeWithText('Jane Doe resume, React and Node.');
    const embed = vi.fn(async () => vec());
    const r = await confirmCandidateDraft(orgId, 'draft-a',
      { full_name: 'Jane Doe', email: `jane-${Date.now()}@x.com`, phone: null,
        current_title: 'Engineer', location: 'NYC' }, { store, embed });

    expect(r.embedding_status).toBe('embedded');
    expect(embed).toHaveBeenCalled();
    expect(store.moves[0]).toEqual([
      `staging/${orgId}/draft-a`, permanentKey(orgId, r.candidate_id, r.document_id!)]);
    const [doc] = await sql`
      select storage_key, embedding_status from candidate_documents where id = ${r.document_id}`;
    expect(doc.storage_key).toBe(permanentKey(orgId, r.candidate_id, r.document_id!));
    expect(doc.embedding_status).toBe('embedded');
    const [emb] = await sql`
      select count(*)::int as n from embeddings where subject_id = ${r.document_id}`;
    expect(emb.n).toBeGreaterThan(0);
  });

  it('keeps the candidate but marks failed when embedding throws', async () => {
    const store = storeWithText('Bob resume text here.');
    const embed = vi.fn(async () => { throw new Error('embed down'); });
    const r = await confirmCandidateDraft(orgId, 'draft-b',
      { full_name: 'Bob Roe', email: `bob-${Date.now()}@x.com`, phone: null,
        current_title: null, location: null }, { store, embed });

    expect(r.candidate_id).toBeTruthy();
    expect(r.embedding_status).toBe('failed');
    const [doc] = await sql`
      select embedding_status from candidate_documents where id = ${r.document_id}`;
    expect(doc.embedding_status).toBe('failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/candidate-drafts.confirm.test.ts`
Expected: FAIL — `confirmCandidateDraft`/`permanentKey` not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/services/candidate-drafts.ts`:

```ts
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { candidate_documents } from '../db/schema';
import { ingestCandidate, upsertEmbeddings } from './ingest';
import type { EmbedFn } from './embed';

export const permanentKey = (orgId: string, candidateId: string, documentId: string) =>
  `resumes/${orgId}/${candidateId}/${documentId}`;

export type ConfirmFields = {
  full_name: string; email: string | null; phone: string | null;
  current_title: string | null; location: string | null;
};
export type ConfirmDeps = { store: ObjectStore; embed: EmbedFn };

export async function confirmCandidateDraft(
  orgId: string, draftId: string, fields: ConfirmFields, deps: ConfirmDeps,
): Promise<{ candidate_id: string; document_id: string | null;
             embedding_status: 'embedded' | 'failed' | 'pending' }> {
  const resumeText = await deps.store.getText(stagingTextKey(orgId, draftId));

  // Commit 1: the candidate + document. Reuses all dedupe/redact/format/chunk logic.
  const ingested = await ingestCandidate({
    org_id: orgId, full_name: fields.full_name, email: fields.email, phone: fields.phone,
    current_title: fields.current_title, location: fields.location,
    source: 'manual_upload', resume_text: resumeText,
  });

  if (!ingested.document_id) {
    return { candidate_id: ingested.candidate_id, document_id: null, embedding_status: 'pending' };
  }
  const documentId = ingested.document_id;

  // Commit 2: promote file + embed. Best-effort — failures here never undo commit 1.
  let status: 'embedded' | 'failed' | 'pending' = 'pending';
  try {
    const permKey = permanentKey(orgId, ingested.candidate_id, documentId);
    await deps.store.move(stagingKey(orgId, draftId), permKey);
    await db.update(candidate_documents)
      .set({ storage_key: permKey }).where(eq(candidate_documents.id, documentId));

    if (ingested.chunks.length > 0) {
      const chunks = [];
      for (let i = 0; i < ingested.chunks.length; i++) {
        const content = ingested.chunks[i];
        chunks.push({
          chunk_index: i, content, embedding: await deps.embed(content),
          content_hash: createHash('sha256').update(content).digest('hex'),
        });
      }
      await upsertEmbeddings({
        org_id: orgId, subject_type: 'candidate_document', subject_id: documentId, chunks,
      });
    }
    status = 'embedded';
  } catch {
    status = 'failed';
  }
  await db.update(candidate_documents)
    .set({ embedding_status: status }).where(eq(candidate_documents.id, documentId));

  return { candidate_id: ingested.candidate_id, document_id: documentId, embedding_status: status };
}
```

Note: move the `import type { ObjectStore }` / `ResumeFile` / `PrefilledFields` lines to sit with these new imports at the top of the file (a file has one import block). Keep `stagingKey`/`stagingTextKey` defined above their first use.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/services/candidate-drafts.confirm.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/candidate-drafts.ts src/services/candidate-drafts.confirm.test.ts
git commit -m "feat: add confirmCandidateDraft (ingest + promote + embed, isolated)"
```

---

### Task 7: Upload route

**Files:**
- Create: `src/app/api/candidates/upload/route.ts`
- Test: `src/app/api/candidates/upload/route.test.ts`

**Interfaces:**
- Consumes: `prepareCandidateDraft`, `defaultStore`, `extractResumeText`, `extractCandidateFields`, `UnsupportedResumeError`, `EmptyResumeError`, `auth()`.
- Produces:
  ```ts
  export function handleUpload(
    req: Request, orgId: string, deps: DraftDeps, maxBytes?: number,
  ): Promise<Response>;   // exported for testing; POST wraps it with session + default deps
  export function POST(req: Request): Promise<Response>;
  ```
- Response: `201 { draft_id, fields, preview }`; `415` unsupported, `422` empty/no-file, `413` too big, `500` otherwise.

- [ ] **Step 1: Read the Next.js route-handler docs**

Confirm `req.formData()` and returning `Response.json(...)` are current for this Next version (`node_modules/next/dist/docs/`). Note anything that differs before writing.

- [ ] **Step 2: Write the failing test**

Create `src/app/api/candidates/upload/route.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { handleUpload } from './route';
import type { DraftDeps } from '../../../../services/candidate-drafts';
import { UnsupportedResumeError } from '../../../../services/resume-extract';

function reqWith(file: File): Request {
  const fd = new FormData();
  fd.set('file', file);
  return new Request('http://x/api/candidates/upload', { method: 'POST', body: fd });
}
const okDeps: DraftDeps = {
  store: { async put() {}, async getText() { return ''; }, async move() {},
    async signedReadUrl() { return ''; } },
  extractText: async () => 'text',
  extractFields: async () => ({ full_name: 'Ada', email: null, phone: null,
    current_title: null, location: null }),
  newId: () => 'draft-x',
};

describe('handleUpload', () => {
  it('returns 201 with a draft on a good upload', async () => {
    const file = new File([new Uint8Array([1, 2])], 'r.pdf', { type: 'application/pdf' });
    const res = await handleUpload(reqWith(file), 'org-1', okDeps);
    expect(res.status).toBe(201);
    expect((await res.json()).draft_id).toBe('draft-x');
  });

  it('returns 422 when no file is attached', async () => {
    const req = new Request('http://x', { method: 'POST', body: new FormData() });
    expect((await handleUpload(req, 'org-1', okDeps)).status).toBe(422);
  });

  it('maps UnsupportedResumeError to 415', async () => {
    const deps = { ...okDeps, extractText: async () => { throw new UnsupportedResumeError(); } };
    const file = new File([new Uint8Array([1])], 'r.doc', { type: 'application/msword' });
    expect((await handleUpload(reqWith(file), 'org-1', deps)).status).toBe(415);
  });

  it('returns 413 when the file exceeds the size cap', async () => {
    const file = new File([new Uint8Array(1024)], 'r.pdf', { type: 'application/pdf' });
    expect((await handleUpload(reqWith(file), 'org-1', okDeps, 512)).status).toBe(413);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/app/api/candidates/upload/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `src/app/api/candidates/upload/route.ts`:

```ts
import { auth } from '../../../../lib/auth';
import {
  prepareCandidateDraft, type DraftDeps,
} from '../../../../services/candidate-drafts';
import { defaultStore } from '../../../../services/storage';
import {
  extractResumeText, UnsupportedResumeError, EmptyResumeError, type ResumeFile,
} from '../../../../services/resume-extract';
import { extractCandidateFields } from '../../../../services/resume-fields';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function defaultDeps(): DraftDeps {
  return {
    store: defaultStore(),
    extractText: (f: ResumeFile) => extractResumeText(f),
    extractFields: (t: string) => extractCandidateFields(t),
    newId: () => crypto.randomUUID(),
  };
}

export async function handleUpload(
  req: Request, orgId: string, deps: DraftDeps, maxBytes = MAX_BYTES,
): Promise<Response> {
  let form: FormData;
  try { form = await req.formData(); }
  catch { return Response.json({ error: 'expected_multipart' }, { status: 400 }); }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: 'no_file' }, { status: 422 });
  }
  if (file.size > maxBytes) {
    return Response.json({ error: 'file_too_large' }, { status: 413 });
  }

  const resumeFile: ResumeFile = {
    bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, filename: file.name,
  };
  try {
    const draft = await prepareCandidateDraft(orgId, resumeFile, deps);
    return Response.json(draft, { status: 201 });
  } catch (err) {
    if (err instanceof UnsupportedResumeError) {
      return Response.json({ error: 'unsupported_type', message: err.message }, { status: 415 });
    }
    if (err instanceof EmptyResumeError) {
      return Response.json({ error: 'empty_resume', message: err.message }, { status: 422 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return handleUpload(req, session.user.org_id, defaultDeps());
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/app/api/candidates/upload/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/candidates/upload/route.ts src/app/api/candidates/upload/route.test.ts
git commit -m "feat: add POST /api/candidates/upload"
```

---

### Task 8: Confirm route

**Files:**
- Create: `src/app/api/candidates/confirm/route.ts`
- Test: `src/app/api/candidates/confirm/route.test.ts`

**Interfaces:**
- Consumes: `confirmCandidateDraft`, `defaultStore`, `defaultEmbedder`, `auth()`.
- Produces:
  ```ts
  export const ConfirmBodySchema: z.ZodType<{ draft_id: string; fields: ConfirmFields }>;
  export function handleConfirm(
    body: unknown, orgId: string,
    run: (orgId: string, draftId: string, fields: ConfirmFields) => ReturnType<typeof confirmCandidateDraft>,
  ): Promise<Response>;
  export function POST(req: Request): Promise<Response>;
  ```
- Response: `201 { candidate_id, document_id, embedding_status }`; `400` invalid body.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/candidates/confirm/route.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleConfirm } from './route';

const okRun = vi.fn(async (_o: string, _d: string, _f: unknown) => ({
  candidate_id: 'c1', document_id: 'd1', embedding_status: 'embedded' as const,
}));

describe('handleConfirm', () => {
  it('returns 201 and the ingest result on a valid body', async () => {
    const res = await handleConfirm(
      { draft_id: 'draft-x', fields: { full_name: 'Ada', email: null, phone: null,
        current_title: null, location: null } }, 'org-1', okRun);
    expect(res.status).toBe(201);
    expect((await res.json()).candidate_id).toBe('c1');
    expect(okRun).toHaveBeenCalledWith('org-1', 'draft-x', expect.objectContaining({ full_name: 'Ada' }));
  });

  it('returns 400 when full_name is missing', async () => {
    const res = await handleConfirm(
      { draft_id: 'draft-x', fields: { full_name: '', email: null, phone: null,
        current_title: null, location: null } }, 'org-1', okRun);
    expect(res.status).toBe(400);
  });

  it('returns 400 when draft_id is missing', async () => {
    const res = await handleConfirm(
      { fields: { full_name: 'Ada', email: null, phone: null,
        current_title: null, location: null } }, 'org-1', okRun);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/api/candidates/confirm/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/app/api/candidates/confirm/route.ts`:

```ts
import { z, ZodError } from 'zod';
import { auth } from '../../../../lib/auth';
import {
  confirmCandidateDraft, type ConfirmFields,
} from '../../../../services/candidate-drafts';
import { defaultStore } from '../../../../services/storage';
import { defaultEmbedder } from '../../../../services/embed';

// The review form sends '' for cleared optional fields. Coerce '' -> null BEFORE
// validation so empties don't reach ingestCandidate (whose email is z.email() and would
// reject ''). email is then validated as a real address, so a malformed one is a clean
// 400 here rather than a 500 out of ingest.
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const ConfirmBodySchema = z.strictObject({
  draft_id: z.string().min(1),
  fields: z.strictObject({
    full_name: z.string().trim().min(1),
    email: z.preprocess(emptyToNull, z.email().nullable()).default(null),
    phone: z.preprocess(emptyToNull, z.string().nullable()).default(null),
    current_title: z.preprocess(emptyToNull, z.string().nullable()).default(null),
    location: z.preprocess(emptyToNull, z.string().nullable()).default(null),
  }),
});

export async function handleConfirm(
  body: unknown, orgId: string,
  run: (orgId: string, draftId: string, fields: ConfirmFields) =>
    ReturnType<typeof confirmCandidateDraft>,
): Promise<Response> {
  let parsed: z.infer<typeof ConfirmBodySchema>;
  try { parsed = ConfirmBodySchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    throw err;
  }
  try {
    const result = await run(orgId, parsed.draft_id, parsed.fields);
    return Response.json(result, { status: 201 });
  } catch {
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = session.user.org_id;
  const body = await req.json().catch(() => null);
  return handleConfirm(body, orgId, (o, d, f) =>
    confirmCandidateDraft(o, d, f, { store: defaultStore(), embed: defaultEmbedder() }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/api/candidates/confirm/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/candidates/confirm/route.ts src/app/api/candidates/confirm/route.test.ts
git commit -m "feat: add POST /api/candidates/confirm"
```

---

### Task 9: `AddCandidate` UI + wire into the candidates page

**Files:**
- Create: `src/app/candidates/AddCandidate.tsx`
- Test: `src/app/candidates/AddCandidate.test.tsx`
- Modify: `src/app/candidates/page.tsx` (place `<AddCandidate />` in the page-head, mirroring `<SourceFromJobDiva />` in `src/app/jobs/page.tsx`)

**Interfaces:**
- Consumes: `POST /api/candidates/upload` (multipart `file`), `POST /api/candidates/confirm` (`{ draft_id, fields }`).
- Client component; two visual states: **pick file** → **review form** (pre-filled, editable, `full_name` required) → on confirm, `router.refresh()` and reset.

- [ ] **Step 1: Write the failing test**

Create `src/app/candidates/AddCandidate.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddCandidate from './AddCandidate';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

beforeEach(() => { vi.restoreAllMocks(); });

describe('AddCandidate', () => {
  it('uploads a file then shows a pre-filled, editable review form', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/upload')) {
        return new Response(JSON.stringify({
          draft_id: 'd1',
          fields: { full_name: 'Ada Lovelace', email: 'ada@x.com', phone: null,
            current_title: 'Engineer', location: 'London' },
          preview: 'resume…',
        }), { status: 201 });
      }
      return new Response(JSON.stringify({ candidate_id: 'c1', embedding_status: 'embedded' }),
        { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AddCandidate />);
    const file = new File([new Uint8Array([1])], 'r.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText(/resume file/i), file);

    await waitFor(() => expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument());
    expect(screen.getByDisplayValue('ada@x.com')).toBeInTheDocument();
  });

  it('blocks confirm when the name has been cleared', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      draft_id: 'd1',
      fields: { full_name: 'Ada', email: null, phone: null, current_title: null, location: null },
      preview: '',
    }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AddCandidate />);
    await userEvent.upload(screen.getByLabelText(/resume file/i),
      new File([new Uint8Array([1])], 'r.pdf', { type: 'application/pdf' }));
    await waitFor(() => screen.getByDisplayValue('Ada'));

    await userEvent.clear(screen.getByLabelText(/full name/i));
    expect(screen.getByRole('button', { name: /save candidate/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/candidates/AddCandidate.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `src/app/candidates/AddCandidate.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Fields = {
  full_name: string; email: string | null; phone: string | null;
  current_title: string | null; location: string | null;
};

const UPLOAD_ERROR: Record<string, string> = {
  unsupported_type: 'Upload a PDF or Word (.docx) file.',
  empty_resume: "Couldn't read any text from that file — it may be scanned or empty.",
  file_too_large: 'That file is too large (max 10 MB).',
  no_file: 'Choose a file to upload.',
};

export default function AddCandidate() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || busy) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch('/api/candidates/upload', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) { setError(UPLOAD_ERROR[body.error] ?? 'Upload failed — try again.'); return; }
      setDraftId(body.draft_id);
      // full_name is required by the form; the extractor may return null, so coerce to ''.
      setFields({ ...body.fields, full_name: body.fields.full_name ?? '' });
    } catch { setError('Upload failed — try again.'); }
    finally { setBusy(false); }
  }

  async function onConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!draftId || !fields || !fields.full_name.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/candidates/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft_id: draftId, fields }),
      });
      if (!res.ok) { setError('Save failed — try again.'); return; }
      setDraftId(null); setFields(null);
      router.refresh();
    } catch { setError('Save failed — try again.'); }
    finally { setBusy(false); }
  }

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => (f ? { ...f, [k]: e.target.value } : f));

  if (!fields) {
    return (
      <div className="add-candidate">
        <label className="btn btn-primary" htmlFor="resume-file">
          {busy ? 'Reading…' : 'Add candidate'}
        </label>
        <input id="resume-file" type="file" accept=".pdf,.docx" aria-label="Resume file"
          onChange={onFile} disabled={busy} hidden />
        {error && <p className="sourcing-error">{error}</p>}
      </div>
    );
  }

  return (
    <form className="add-candidate-review" onSubmit={onConfirm}>
      <label>Full name<input aria-label="Full name" value={fields.full_name}
        onChange={set('full_name')} /></label>
      <label>Email<input aria-label="Email" value={fields.email ?? ''} onChange={set('email')} /></label>
      <label>Phone<input aria-label="Phone" value={fields.phone ?? ''} onChange={set('phone')} /></label>
      <label>Title<input aria-label="Title" value={fields.current_title ?? ''}
        onChange={set('current_title')} /></label>
      <label>Location<input aria-label="Location" value={fields.location ?? ''}
        onChange={set('location')} /></label>
      <button type="submit" className="btn btn-primary"
        disabled={busy || !fields.full_name.trim()}>
        {busy ? 'Saving…' : 'Save candidate'}
      </button>
      {error && <p className="sourcing-error">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/candidates/AddCandidate.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire it into the candidates page**

In `src/app/candidates/page.tsx`, import and render the component in the page header, mirroring how `src/app/jobs/page.tsx` renders `<SourceFromJobDiva />` inside its `.page-head`:

```tsx
import AddCandidate from './AddCandidate';
// …inside the page-head JSX, after the lede:
        <AddCandidate />
```

- [ ] **Step 6: Run the full suite + typecheck + lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/candidates/AddCandidate.tsx src/app/candidates/AddCandidate.test.tsx src/app/candidates/page.tsx
git commit -m "feat: add AddCandidate upload UI to candidates page"
```

---

## Post-implementation (manual, not code)

- **GCS bucket + lifecycle:** create the `GCS_RESUME_BUCKET` bucket and add a lifecycle rule deleting objects under `staging/` after 24h (spec §Staging). Grant the Cloud Run service account `roles/storage.objectAdmin` on it. Set `GCS_RESUME_BUCKET` in the app service env.
- **Verify in preview:** upload a real PDF and a real DOCX through the running app; confirm the candidate appears in the pool and `embeddings` rows exist for its document.

## Spec coverage check

- Entry point (global Add candidate) → Task 9. Auto-extract + confirm → Tasks 3, 5, 9. In-app synchronous → Tasks 5, 7. GCS original file → Tasks 4, 6. Staging Option A (`staging/<org>/…` + `.txt` sidecar, 24h lifecycle) → Tasks 5, 6, Post-impl. In-app embedding after confirm, isolated → Task 6. `embedding_status` retryable marker → Tasks 1, 6. Dedupe reuse → Task 6 (via `ingestCandidate`). PDF+DOCX only, reject `.doc` → Task 2. Error handling (415/422/413) → Task 7. Tests (unit + service + route) → every task. Deferred items (bulk, upload-into-job, auto-retry, `.doc`) → intentionally absent.
