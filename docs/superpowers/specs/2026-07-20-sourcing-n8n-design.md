# Sourcing: UI → n8n → JobDiva — Design

**Date:** 2026-07-20
**Status:** Approved (brainstormed with Rick)

## Goal

Let a recruiter source candidates for a job order from the UI: enter a JobDiva job
number (importing the job if we don't have it) or click **Source candidates** on an
existing job order. The click triggers the existing n8n sourcing workflow, which
searches the internal pool first, falls back to JobDiva only when internal results are
thin, embeds only new/changed candidates, and shows the recruiter the ranked shortlist
live on the job page. Every JobDiva pull permanently grows the internal pool, so
sourcing gets cheaper as the database grows.

## Decisions made

| Question | Decision |
|---|---|
| Entry point | Both: JobDiva job-number import on `/jobs`, and a Source button on `/jobs/[id]` |
| JobDiva candidate policy | Internal pool first; call JobDiva only when internal results are thin |
| Results UX | Live on the job page (phase progress + shortlist); Decision still lands in Cockpit |
| JobDiva pull style | Per-job targeted search (title + must-haves), resumes fetched only for new candidates |
| Shortlist → ATS | Auto-create Applications at stage `sourced` for every shortlisted candidate |
| Architecture | Approach C: orchestration stays in n8n; every capability is a tested TS service behind `/api/agent/*` |

## Architecture & data flow

One new noun: a **Sourcing Run** — a `sourcing_runs` row tracking a single click of
Source, with a `phase` the workflow advances. It powers the live job-page status and
gives sourcing an audit trail keyed to the recruiter's action (distinct from
`agent_runs`, which is per-model-call telemetry).

```
Recruiter (either entry point)
  A. /jobs: enters JobDiva job # → POST /api/jobs/import → create/find job order → redirect to /jobs/[id]
  B. /jobs/[id]: clicks "Source candidates"
  ▼
POST /api/jobs/[id]/source        (session-auth'd, org-scoped app route)
  ├─ inserts sourcing_runs row (phase 'queued')
  └─ fires n8n POST /webhook/source { org_id, job_order_id, sourcing_run_id }
  ▼
n8n Sourcing workflow (extended)
  1. phase 'searching_pool': embed job text (content_hash skip), vector-search internal pool
  2. thin check: fewer than MIN_GOOD_MATCHES results under MAX_DISTANCE?
       yes → phase 'checking_jobdiva': POST /api/agent/jobdiva/import-candidates
             (targeted JobDiva search; dedupe via ingestCandidate; embed ONLY new/changed
              resumes; phase 'embedding_new' with counts) → re-run internal search once
  3. phase 'shortlisting': propose + complete source.shortlist Decision (as today)
  4. upsert Applications at stage 'sourced' for the shortlist
  5. hand off to /webhook/screen (as today); phase 'screening'
  6. phase 'done' (or 'failed' with error at any step)
  ▼
/jobs/[id]: client component polls GET /api/jobs/[id]/source (latest run)
  → phase progress, then ranked shortlist; pipeline board fills with sourced
    Applications; fit badges appear as screening scores land
```

Key properties:

- The browser never talks to n8n or JobDiva — only app server routes do, using
  `N8N_WEBHOOK_URL` and the existing `JOBDIVA_*` env vars.
- "Check our DB before JobDiva" is structural: JobDiva is reachable only through the
  thin-check branch, and dedupe (`jobdiva_id`-first, already in `ingestCandidate`) plus
  `content_hash` embedding skip make already-known candidates cost zero embedding calls.
- Re-sourcing is idempotent: job embedding hash-skipped, applications upserted against
  the existing unique `(job_order_id, candidate_id)` constraint, candidates deduped.

## Database

One new table, `sourcing_runs`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid → orgs | |
| `job_order_id` | uuid → job_orders | |
| `requested_by` | uuid, nullable | user id; null for orchestrator-triggered runs |
| `phase` | text | `queued → searching_pool → checking_jobdiva → embedding_new → shortlisting → screening → done \| failed` |
| `stats` | jsonb | `{ pool_matches, jobdiva_found, jobdiva_new, embedded, shortlisted, skipped, jobdiva_error? }` |
| `error` | text, nullable | set only when phase is `failed` |
| `created_at` / `updated_at` | timestamptz | |

No other schema changes: `job_orders.jobdiva_id` and `candidates.jobdiva_id` already
exist, as do `embeddings.content_hash` and the applications unique constraint.

## JobDiva client — `src/services/jobdiva.ts`

One deep module hiding all JobDiva ugliness (token auth + refresh, endpoint shapes,
pagination, rate limiting). Interface:

- `getJob(jobNumber)` → `{ title, description, must_haves, nice_to_haves, kind }` mapped
  to our job-order shape
- `searchCandidates({ title, mustHaves, location? })` → `Array<{ jobdiva_id, full_name,
  email, phone, current_title, location }>`
- `getResumeText(jobdivaCandidateId)` → `string | null`

Built like `embed.ts`: factory taking `fetchFn` for testability; config from
`JOBDIVA_CLIENT_ID` / `JOBDIVA_USERNAME` / `JOBDIVA_PASSWORD`.

The exact JobDiva REST endpoints and response shapes must be verified against JobDiva's
API documentation during implementation. This interface is the contract; the client's
internals are the implementer's concern. If a needed capability (e.g. free-text
candidate search) turns out not to exist in JobDiva's API, the implementer adapts the
internals (e.g. skill-code search) without changing this interface.

## API routes

Session-authenticated (recruiter-facing, org from session):

1. `POST /api/jobs/import` — body `{ jobdiva_job_number }`. Dedupe on
   `job_orders.jobdiva_id` first; else `getJob()` → insert job order. Returns
   `{ job_order_id, created }`. Errors (unknown number, JobDiva down) return 4xx/5xx
   with a message the form renders inline.
2. `POST /api/jobs/[id]/source` — inserts the `sourcing_runs` row, fires the n8n
   webhook, returns `{ sourcing_run_id }`. 409 if a run for this job is already in a
   non-terminal phase. If the webhook call fails, marks the run `failed` immediately.
3. `GET /api/jobs/[id]/source` — latest run (phase, stats, error) plus the ranked
   shortlist from the latest `source.shortlist` Decision payload once available.
   Polling target. Includes the staleness guard (below).

Agent-key-authenticated (workflow-facing, like all existing `/api/agent/*`):

4. `POST /api/agent/jobdiva/import-candidates` — body `{ job_order_id,
   sourcing_run_id? }`. Targeted JobDiva search from the job's title + must-haves; each
   hit flows through existing `ingestCandidate` (dedupe) and `upsertEmbeddings`
   (hash-skip). Resumes fetched only for candidates that are new or have no document on
   file, capped per run (start: 25). Updates run phase/stats as it goes. Returns counts.
5. `PATCH /api/agent/sourcing-runs/[id]` — phase/stats/error advance hook for the
   workflow.
6. `POST /api/agent/applications` — bulk upsert `{ job_order_id, candidate_ids }` →
   applications at `sourced`, `on conflict do nothing`.

## n8n workflow changes

`sourcing.workflow.mjs` (same single Code-node pattern):

1. Accept optional `sourcing_run_id`; phase updates are skipped when absent, so
   orchestrator-triggered runs (`job_order.created`) keep working unchanged.
2. Job-embedding reuse: hash the job text and skip the Gemini call when an unchanged
   `job_order` embedding already exists.
3. Thin check after the internal search: count results with `distance < MAX_DISTANCE`
   (start `0.55`); if fewer than `MIN_GOOD_MATCHES` (start `10`), call
   `import-candidates`, then re-run the search once. Both constants live in
   `helpers.js`, named, with a comment that they're tuning knobs.
4. After the shortlist Decision: `POST /api/agent/applications` with shortlisted ids.
5. Phase updates at each step; on any thrown error, set `phase 'failed'` with the
   message before rethrowing.

Orchestrator, screening, and all other workflows: unchanged.

## UI

Both touchpoints in the existing Control Room card style.

1. **`/jobs` list page** — a "Source from JobDiva" input: enter a job number, submit →
   `/api/jobs/import` → route to `/jobs/[id]?source=1`; the Sourcing panel sees the
   query param and fires `POST /api/jobs/[id]/source` on mount (the 409 guard makes a
   stale/bookmarked `?source=1` harmless). Import errors render inline on the form.
2. **`/jobs/[id]` page** — a **Source candidates** button in the detail header, plus a
   **Sourcing panel** between the stats row and the pipeline board: a client component
   polling `GET /api/jobs/[id]/source` every ~2.5s while a run is active.
   - Active: phase progress ("Searching internal pool → Checking JobDiva → Embedding 12
     new candidates → Shortlisting…") with counts from `stats`.
   - Finished: ranked shortlist — linked candidate name, current title, similarity, fit
     badge once screening scores exist. `router.refresh()` on `done` so the pipeline
     board picks up the new `sourced` Applications.
   - Failed: the error + a Retry button.
   - Button disabled while a run is in a non-terminal phase.

Polling, not SSE: the cockpit SSE stream is decision-shaped; a 2.5s poll on one
lightweight endpoint is enough for a recruiter watching one job.

## Error handling

- **n8n unreachable on click**: POST marks the run `failed` immediately ("Couldn't
  reach the agent runtime") — nothing hangs in `queued`.
- **Workflow dies mid-run**: the workflow's catch sets `failed` + message. For crashes
  where even that can't run, `GET /api/jobs/[id]/source` reports any run stuck in a
  non-terminal phase for over 10 minutes as `failed` ("timed out") — the Source button
  always comes back.
- **JobDiva failures are soft**: if `import-candidates` errors (auth, rate limit,
  downtime), the workflow records `stats.jobdiva_error` and continues with
  internal-only results. Panel shows "JobDiva unavailable — internal pool only."
- **Per-candidate ingest failures are soft**: skip the candidate, increment `skipped`,
  never abort the batch (same isolation philosophy as screening's per-candidate
  try/catch).
- **Empty shortlist**: valid outcome, not an error — run completes with
  `shortlisted: 0`; panel suggests loosening must-haves.
- **Concurrency**: 409 on non-terminal runs plus the existing advisory-lock dedupe in
  `ingestCandidate` cover double-clicks and overlapping recruiters.

## Testing

Vitest (existing patterns):

- `jobdiva.ts`: stubbed-`fetchFn` unit tests — auth/token refresh, response mapping,
  pagination, resume-fetch cap. No live JobDiva calls.
- API routes: route tests like existing `route.test.ts` files — auth rejection (session
  vs agent-key), validation, `/api/jobs/import` dedupe, 409 on non-terminal run,
  staleness guard.
- Services: `sourcing_runs` phase transitions; applications bulk-upsert conflict
  behavior.

n8n shell tests:

- Extend `n8n/tests/sourcing-screening.sh`: thin-check branch (near-empty pool, JobDiva
  stubbed via an env-pointed base URL) and phase progression on a `sourcing_runs` row.

Playwright (new to the repo):

- Install `@playwright/test` + Chromium; `playwright.config.ts` boots the Next.js dev
  server against the seeded local DB (`db:reseed`).
- E2E specs for the two recruiter journeys: (1) `/jobs` → enter a job number → land on
  the job page with sourcing auto-started; (2) job page → Source → panel walks through
  phases → shortlist renders → `sourced` cards appear on the pipeline board. n8n and
  JobDiva edges stubbed with a small fixture server — e2e needs neither Docker n8n nor
  JobDiva credentials (the n8n shell tests cover the real workflow side).
- `test:e2e` script in `package.json`, excluded from the default `vitest` run.

Manual: `scripts/jobdiva-smoke.ts` for one-off verification of the client against the
real JobDiva API (not in CI).

## Out of scope

- Background bulk sync of JobDiva candidates (revisit when volume justifies it —
  "Targeted now, bulk later" was considered and deferred).
- SSE for sourcing progress (polling is enough; revisit if it needs to be snappier).
- LLM-based query building for the JobDiva search (title + must-haves keywords first).
- Any change to screening, communication, data-steward, or heartbeat workflows.
