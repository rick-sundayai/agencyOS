# Manual Resume Upload — Design

**Date:** 2026-07-25
**Status:** Approved (design)
**Scope:** The second candidate-ingestion path — a recruiter manually uploads a PDF or
Word resume. The JobDiva/n8n sourcing path is already built and is out of scope here,
except that this path reuses its downstream services (`ingestCandidate`,
`formatForEmbedding`, `chunkForEmbedding`, `redactForEmbedding`, `embed.ts`,
`upsertEmbeddings`).

## Goal

A recruiter, from a global **Add candidate** action, uploads a single resume file. The
system extracts the resume text and pre-fills the candidate's structured fields, the
recruiter reviews/corrects them, confirms, and the candidate lands in the pool —
searchable by vector — with the original file retained.

Not tied to any job order; the candidate enters the pool and can be attached to a job
later. Single-file first; the endpoints are written so batch upload is a later loop over
the same primitives, not a redesign.

## Decisions (locked)

| Question | Decision |
|---|---|
| Entry point | Global "Add candidate" → pool, not tied to a job order |
| Field extraction | Auto-extract via LLM, recruiter confirms in a review form |
| Where parsing/extraction runs | In-app, synchronous (Next.js route); n8n not involved |
| Original file | Persisted to object storage (GCS); real `storage_key` |
| Staging between upload & confirm | **Option A** — persist to GCS under a `staging/` prefix, return a `draft_id` |
| Embedding trigger | In-app, right after confirm; isolated from ingest so a failed embed never loses the candidate |
| Batch | Single-file first; bulk is a later loop |

## Flow

```
Recruiter (Control Room → Add candidate)
  │  ① uploads resume.pdf / .docx  (multipart)
  ▼
POST /api/candidates/upload                       [in-app, synchronous]
  │  • validate mime/extension + size
  │  • extractResumeText(file) → raw text
  │  • extractCandidateFields(text) → {full_name,email,phone,current_title,location}
  │  • write file bytes to GCS:  staging/<draft_id>.<ext>
  │  • return { draft_id, prefilled_fields, parsed_text_preview }
  ▼
Review form (recruiter corrects fields)
  │  ② confirm
  ▼
POST /api/candidates/confirm  { draft_id, fields }
  │  • ingestCandidate(fields + resume_text)      → candidate_id, document_id, chunks
  │  • promote GCS object: staging/<draft_id> → candidates/<candidate_id>/v<n>.<ext>
  │    and set candidate_documents.storage_key to the permanent key
  │  • embed chunks via embed.ts → upsertEmbeddings   (separate commit)
  ▼
candidate in pool, searchable
```

Two endpoints. The split is what gives the recruiter a review step without re-uploading
the file.

## Components

### New

- **`AddCandidate` UI** — a global action in the candidates surface / Control Room.
  States: dropzone → uploading/extracting → pre-filled review form → confirming → done.
  Single file. Follows the house Control Room card style (semantic-CSS token layer).
- **`extractResumeText(file: {bytes, mime, filename}): Promise<string>`** — service in
  `src/services/`. Dispatches by mime/extension: PDF → a pdf text extractor, DOCX →
  `mammoth`. Returns plain text. Throws a typed error for unsupported/encrypted/empty
  files. (Library choices confirmed at plan time per the repo's "read the Next.js docs
  first" rule; DOC legacy binary is **not** supported — PDF + DOCX only.)
- **`extractCandidateFields(text: string): Promise<PrefilledFields>`** — service. One
  Gemini call returning the strict field set. Reuses existing Gemini plumbing. Runs
  server-side only; raw resume text never goes to the browser beyond a short preview.
- **GCS storage adapter** — `src/services/storage.ts` (or similar):
  `putResumeObject(key, bytes, contentType)`, `promoteResumeObject(fromKey, toKey)`,
  `signedReadUrl(key)`. Backed by a GCS bucket (Cloud Run / GCP, matching current infra).

### Reused unchanged

`ingestCandidate`, `formatForEmbedding`, `chunkForEmbedding`, `redactForEmbedding`,
`embed.ts` (`defaultEmbedder`), `upsertEmbeddings`.

### Schema change

`candidate_documents` gains an **`embedding_status`** column
(`text`, default `'pending'`, values `pending | embedded | failed`). A Drizzle migration
adds it. Confirm sets it to `embedded` on success, `failed` if the embed call throws.
This is what makes a failed embed retryable instead of silently unsearchable.

## Data flow & PII

- Extraction (`extractCandidateFields`) sees the **raw** resume text — it must, to find
  name/contact fields. This stays entirely server-side.
- Embedding uses the existing `redactForEmbedding` → `formatForEmbedding` →
  `chunkForEmbedding` pipeline, so the vector store still never receives PII, exactly as
  the JobDiva path does today.
- The browser receives only the pre-filled fields plus a short `parsed_text_preview`,
  never the full raw text as a persisted round-trip.

## Staging (Option A) details

- On upload, the file is written to `staging/<draft_id>.<ext>` in GCS and `draft_id`
  (a uuid) is returned. The parsed text is **not** persisted separately at this stage —
  it is re-derived at confirm from the staged file, or (optimization, plan-time) cached
  alongside. The review survives a page reload because the draft is server-side.
- Confirm promotes the staged object to its permanent
  `candidates/<candidate_id>/v<version>.<ext>` key and records that key as
  `storage_key`.
- Un-confirmed drafts are reaped by a GCS lifecycle rule on the `staging/` prefix
  (e.g. delete after 24h). No app-side sweeper needed.

## Error handling

- **Unsupported type / oversized / encrypted / empty PDF** → 4xx from `/upload` with a
  clear recruiter-facing message; nothing persisted (no staged object left behind, or it
  is cleaned up).
- **Extraction returns empty/garbage fields** → still return the review form with blank
  fields; recruiter fills manually. Extraction quality never blocks the flow.
- **Embedding fails at confirm** → candidate and document are already committed; the
  document's `embedding_status` is `failed`, surfaced for retry. Ingest and embed are
  **separate commits** so one cannot roll back the other.
- **Dedupe** → `ingestCandidate` already dedupes on jobdiva_id / email / phone and
  versions the document. A re-uploaded resume for an existing person updates the
  candidate and adds a new document version rather than creating a duplicate.

## Testing

- **Unit:** `extractResumeText` against sample PDF + DOCX fixtures (including one
  encrypted/empty PDF that must throw the typed error); `extractCandidateFields` with a
  stubbed deterministic Gemini response.
- **Service:** upload→confirm happy path; dedupe-on-confirm (existing candidate updated,
  document versioned); embedding-failure isolation (candidate + document persist,
  `embedding_status = 'failed'`).
- **Route/integration:** multipart validation (bad type, too big); draft promotion moves
  the object and sets the permanent `storage_key`.

## Out of scope (deferred)

- Bulk / drag-many upload (later loop over the same endpoints).
- Upload-into-a-specific-job-order entry point (this design is pool-only).
- Automatic embedding retry/backoff job for `embedding_status = 'failed'` (retry is
  manual/surfaced for now).
- Legacy `.doc` binary format.
