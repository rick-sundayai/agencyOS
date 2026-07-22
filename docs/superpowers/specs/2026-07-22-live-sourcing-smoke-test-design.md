# Live sourcing smoke test: first real JobDiva + Gemini run — Design

**Date:** 2026-07-22
**Status:** Executed 2026-07-22 — PASS. See `docs/superpowers/reports/2026-07-22-live-sourcing-smoke-test-report.md`
**Approach:** Staged pre-flight, then UI run (Approach A — prove each external seam in
isolation before the first click)

## Goal

Prove the shipped UI-triggered sourcing flow (`a0d15cb` design, complete through
`0c835d8`) works against **real** production JobDiva and **real** Gemini embeddings,
end to end, on the local dev stack. Every prior test used stubbed n8n + JobDiva; this
is the first live run.

Test case: JobDiva job number **23-00053**, entered in the `/jobs` import form.

## Decisions made

- **Environment:** local dev stack (docker compose Postgres/pgvector + n8n + Mailpit,
  `npm run dev`). Staging-stamp repeat is a follow-up session, out of scope here.
- **JobDiva:** production tenant, read-only (job fetch, candidate search, resume
  fetch — the flow never writes to JobDiva). Rick approved production reads.
- **DB state:** clean start — foundation rows only (org, admin user, autonomy policy,
  scorer prompts), **zero candidates**, so the thin-check deterministically triggers
  the JobDiva fallback. NOTE: `npm run db:reseed` is wrong for this — it generates 500
  fake candidates, which would thicken the pool and suppress the fallback. Use a fresh
  volume + `db:migrate` + `db:seed`; verify `seed.ts` seeds no candidates first.
- **Secrets location:** `.env` (gitignored via `.env*`), not `.env.local` — the
  standalone tsx scripts (`jobdiva-smoke.ts`, `seed.ts`, `reseed.ts`) load env via
  `dotenv/config`, which reads only `.env`; Next.js reads both. `.env` is the one file
  every consumer sees. `GEMINI_API_KEY` is already there (confirmed live).

## Prerequisites from Rick

| # | Item | Status |
|---|---|---|
| 1 | `JOBDIVA_CLIENT_ID`, `JOBDIVA_USERNAME`, `JOBDIVA_PASSWORD`, `JOBDIVA_BASE_URL` pasted into `.env` (Rick pastes; agent never handles secret values) | **Open — not yet in `.env`** |
| 2 | `GEMINI_API_KEY` live with quota | Done (in `.env`) |
| 3 | Test job number | Done — `23-00053` |
| 4 | Docker Desktop installed/running | Done |
| 5 | Go/no-go on read-only production JobDiva calls | Approved |

## Pass criteria

The run ends `done` in the SourcingPanel, and all of the following hold in Postgres:

1. `job_orders` row imported from JobDiva job `23-00053`.
2. `candidates` rows inserted with `jobdiva_id` set (pool was empty, so all
   shortlisted candidates came from JobDiva).
3. `embeddings` rows for those candidates: real 3072-dim `gemini-embedding-001`
   vectors, `content_hash` set.
4. `applications` rows at stage `sourced` for the shortlist, plus a completed
   `source.shortlist` decision.
5. SourcingPanel showed live phase progress and the ranked shortlist.

**Idempotency (bonus, same session):** clicking Source again on the same job creates a
second run with no duplicate candidates and `stats.skipped > 0` (embeds skipped).

## Phases

### Phase 0 — Environment setup

- Rick adds the four `JOBDIVA_*` lines and `N8N_WEBHOOK_URL=http://localhost:5678/webhook`
  to `.env`.
- `docker compose up -d` (pgvector pg17 :5433, n8n 2.6.4 :5678, Mailpit :8025).
- Clean DB: `docker compose down -v` (note: wipes the n8n volume too — its workflows
  are restored by `apply.sh` below, which is why apply runs *after* this) →
  `docker compose up -d` → `npm run db:migrate` → `npm run db:seed` (verify
  foundation-only; add a targeted wipe if seed includes candidates).
- `bash n8n/apply.sh` — build, import, republish, restart (n8n 2.6.4 deactivates
  workflows on import; apply.sh republishes).
- `npm run dev`.
- Explicit cross-boundary checks: the `AGENT_API_KEY` the n8n container sends must
  equal the app's; the n8n container must reach the host app via
  `host.docker.internal:3000`, not `localhost`.

### Phase 1 — Pre-flight (no UI until all four are green)

1. **JobDiva seam:** `npx tsx scripts/jobdiva-smoke.ts 23-00053` — proves auth, job
   fetch, candidate search, resume fetch against production; doubles as a preview of
   what sourcing will find. Highest-risk seam: the client was built against fixtures,
   live response shapes may drift.
2. **Embedding seam:** one-off Gemini call returns a 3072-float vector.
3. **n8n seam:** healthz + all workflows imported *and active*.
4. **App ↔ n8n handshake:** app boots, login works, manual curl to an `/api/agent/*`
   route with the container's key confirms auth alignment.

Any failure: diagnose and fix at that seam, re-run that check only.

### Phase 2 — Live UI run

Driven in the browser (screenshots captured): log in → `/jobs` → enter `23-00053` →
redirect to job page → SourcingPanel auto-starts → phases stream
`queued → searching_pool → checking_jobdiva → embedding_new → shortlisting →
screening → done`. App logs and n8n executions tailed in parallel so failures are
caught at their layer. Screening runs real Gemini scoring on the shortlist (small
cost); communication output lands in Mailpit only — nothing leaves the machine.

### Phase 3 — Verification & report

- SQL assertions for every pass criterion.
- Idempotency re-run (see above).
- Short test-report doc with screenshots of the panel and the run stats.

## Known risks (expected, not blocking)

- Live JobDiva response-shape drift vs. fixtures; auth/rate-limit quirks.
- `host.docker.internal` networking from the n8n container to the host app.
- Stale workflow versions inside the n8n container (apply.sh re-import fixes).
- Empty-pool edge: if JobDiva returns zero candidates for `23-00053`'s search terms,
  the run degrades to internal-only (by design) and the shortlist is empty — that is a
  *finding about the search terms*, not a test failure; pick a second job and re-run.

## Out of scope

- Repeat on the GCP staging stamp (natural follow-up session).
- Scorer prompt calibration / score-v2.3.0 promotion (RecruiterPro-scoped, CAL-0003).
- JobDiva client-dedupe gap (`(org_id, name)` matching — deliberately deferred).
- Automated live e2e (flaky + costs money per run; existing stubbed Playwright stays).
