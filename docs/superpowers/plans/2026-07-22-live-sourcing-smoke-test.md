# Live Sourcing Smoke Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the shipped UI-triggered sourcing flow works end to end against real production JobDiva (job `23-00053`) and real Gemini embeddings, on the local dev stack, with candidates inserted, embedded, and stored in Postgres.

**Architecture:** This is an operational verification plan, not a build plan — the feature code is already shipped and stub-tested. Tasks fix the environment, prove each external seam in isolation (JobDiva, Gemini, n8n, agent auth), then run the real UI journey and assert every pass criterion in SQL. Spec: `docs/superpowers/specs/2026-07-22-live-sourcing-smoke-test-design.md`.

**Tech Stack:** Next.js app (`npm run dev`, :3000), docker compose (pgvector Postgres :5433, n8n 2.6.4 :5678, Mailpit :8025), tsx scripts, psql.

## Global Constraints

- **Never print or read secret values.** Env files are inspected with name-only greps (`grep -oE '^[A-Za-z_0-9]+=' file | sed 's/=$//'`) and compared with checksums — never `cat`.
- **JobDiva is production, read-only.** Only `getJob`, `searchCandidates`, `getResumeText` are ever called. Nothing writes to JobDiva. Approved by Rick 2026-07-22.
- Test job number: **`23-00053`** (Rick picks a backup at run time if it yields zero candidates).
- Login: `rick@sundayaiwork.com` / `change-me-locally` (from `src/db/seed.ts`).
- Local DB DSN (non-secret, from `.env.example`): `postgres://agency:agency@localhost:5433/agency`. Run SQL via `docker compose exec -T db psql -U agency -d agency -c "..."`.
- Expected phase sequence (from `src/contracts/sourcing.ts`): `queued → searching_pool → checking_jobdiva → embedding_new → shortlisting → screening → done`.
- Env files are gitignored — env-fix tasks produce no commits.

---

### Task 1: Fix env var names so the code can actually see the credentials

**Why:** Rick pasted the JobDiva credentials as `client_id`, `Username`, `PWD` (in both `.env` and `.env.local`), but the code reads `JOBDIVA_CLIENT_ID`, `JOBDIVA_USERNAME`, `JOBDIVA_PASSWORD` (see `.env.example`). `JOBDIVA_BASE_URL` is missing. Also, `docker-compose.yml` interpolates `${AGENT_API_KEY}` into the n8n container from `.env` — but that key currently lives only in `.env.local`, which docker compose does not read, so n8n would get an empty key.

**Files:**
- Modify: `.env`, `.env.local` (gitignored; no commit)

**Interfaces:**
- Produces: `.env` containing `DATABASE_URL`, `GEMINI_API_KEY`, `AUTH_SECRET`, `N8N_WEBHOOK_URL`, `JOBDIVA_CLIENT_ID`, `JOBDIVA_USERNAME`, `JOBDIVA_PASSWORD`, `JOBDIVA_BASE_URL`, `AGENT_API_KEY`. All later tasks depend on this.

- [ ] **Step 1: Compare the duplicated credential lines between the two files (checksums only — values never displayed)**

```bash
for k in client_id Username PWD; do
  a=$(grep "^$k=" .env | md5 -q); b=$(grep "^$k=" .env.local | md5 -q);
  [ "$a" = "$b" ] && echo "$k: identical" || echo "$k: DIFFER — STOP and ask Rick which is correct";
done
```

Expected: three lines of `identical`. **If any line says DIFFER, stop and ask Rick** which file has the right value before proceeding.

- [ ] **Step 2: Rename the keys in `.env` and remove the strays from `.env.local`**

```bash
sed -i '' -e 's/^client_id=/JOBDIVA_CLIENT_ID=/' -e 's/^Username=/JOBDIVA_USERNAME=/' -e 's/^PWD=/JOBDIVA_PASSWORD=/' .env
sed -i '' -e '/^client_id=/d' -e '/^Username=/d' -e '/^PWD=/d' .env.local
```

(`.env` becomes the single source for JobDiva creds; the app reads it too, so no duplication needed.)

- [ ] **Step 3: Add `JOBDIVA_BASE_URL` and copy `AGENT_API_KEY` into `.env` (value flows file-to-file, never through the terminal)**

```bash
echo 'JOBDIVA_BASE_URL=https://api.jobdiva.com' >> .env
grep '^AGENT_API_KEY=' .env.local >> .env
```

- [ ] **Step 4: Verify names (no values)**

```bash
grep -oE '^[A-Za-z_0-9]+=' .env | sed 's/=$//' | sort
```

Expected exactly: `AGENT_API_KEY AUTH_SECRET DATABASE_URL GEMINI_API_KEY JOBDIVA_BASE_URL JOBDIVA_CLIENT_ID JOBDIVA_PASSWORD JOBDIVA_USERNAME N8N_WEBHOOK_URL` (one per line). No lowercase strays remain in either file.

---

### Task 2: Clean stack — fresh volumes, migrate, foundation-only seed, workflows applied

**Files:** none modified (operational).

**Interfaces:**
- Consumes: Task 1's `.env` (compose interpolates `AGENT_API_KEY`/`GEMINI_API_KEY` into the n8n container).
- Produces: running stack; Postgres with foundation rows and **zero candidates**; n8n with all workflows imported and active.

- [ ] **Step 1: Wipe and restart the stack** (destroys local DB + n8n volumes — dev-only data, per approved spec)

```bash
docker compose down -v && docker compose up -d
```

Expected: `db`, `n8n`, `mailpit` containers up. Wait for Postgres: `docker compose exec -T db pg_isready -U agency` → `accepting connections` (retry a few seconds if needed).

- [ ] **Step 2: Migrate and seed foundation rows**

```bash
npm run db:migrate && npm run db:seed
```

Expected: migrate completes without error; seed prints `Seeded org <uuid> with <N> policy rows`. (`seed.ts` is confirmed foundation-only: org, admin user, autonomy policy, scorer prompts — **no candidates**. Do NOT run `db:reseed`; it creates 500 fake candidates and would suppress the JobDiva fallback.)

- [ ] **Step 2b: Seed the agent auth row.** `src/lib/agent-auth.ts` validates `x-agent-api-key` by looking up a sha256 hash in the `agents` table — `seed.ts` creates no such row, and without it every `/api/agent/*` call returns 401 (known gap from the previous plan's ledger; `reseed.ts` seeds it with bcrypt, which agent-auth rejects). Insert one row hashed from the real `AGENT_API_KEY` (value never printed):

```bash
npx tsx -e "import 'dotenv/config'; import { createHash } from 'node:crypto'; import postgres from 'postgres'; const sql = postgres(process.env.DATABASE_URL!, { max: 1 }); const hash = createHash('sha256').update(process.env.AGENT_API_KEY!).digest('hex'); (async () => { const [{ id }] = await sql\`select id from orgs limit 1\`; await sql\`insert into agents (org_id, name, system_prompt, api_key_hash) values (\${id}, 'n8n-shared', 'shared n8n agent API credential (local dev)', \${hash})\`; console.log('agent auth row seeded'); await sql.end(); })();"
```

Expected: `agent auth row seeded`. (Note: `dotenv/config` reads `.env`, so this requires Task 1's `AGENT_API_KEY` copy into `.env`.)

- [ ] **Step 3: Assert the pool is empty**

```bash
docker compose exec -T db psql -U agency -d agency -c "select (select count(*) from candidates) as candidates, (select count(*) from embeddings) as embeddings, (select count(*) from orgs) as orgs;"
```

Expected: `candidates 0, embeddings 0, orgs 1`.

- [ ] **Step 4: Build, import, and activate the n8n workflows**

```bash
bash n8n/apply.sh
```

Expected: ends with `n8n up`. Then verify activation (n8n 2.6.4 deactivates on import; apply.sh republishes):

```bash
docker compose exec -T n8n n8n list:workflow
```

Expected: all workflows listed (orchestrator, data-steward, sourcing, screening, communication, heartbeat) — none inactive.

---

### Task 3: Pre-flight seam 1 — JobDiva against production

**Interfaces:**
- Consumes: `JOBDIVA_*` vars in `.env` (script loads via `dotenv/config`, which reads only `.env`).
- Produces: confidence that auth, job fetch, candidate search, and resume fetch work live; a preview of what sourcing will find for `23-00053`.

- [ ] **Step 1: Run the smoke script**

```bash
npx tsx scripts/jobdiva-smoke.ts 23-00053
```

Expected output shape:
- `getJob: { ... }` — a job object with `title` and `must_haves` (not `null`; `null` means the job number wasn't found — confirm the number with Rick).
- `searchCandidates: N hits` with `N > 0`, and the first 3 candidate objects each showing a `jobdiva_id`.
- `getResumeText length: <number>` — a positive integer.

- [ ] **Step 2: If it fails, debug at this seam only** (superpowers:systematic-debugging): auth errors → credential values or `JOBDIVA_BASE_URL`; shape errors (`undefined` field reads) → live API drift vs. the fixtures `src/services/jobdiva.ts` was built against — fix the client, add/adjust its unit test in `src/services/jobdiva.test.ts`, commit the fix, re-run Step 1. Do not proceed until green.

- [ ] **Step 3: Record the numbers** (job title, hit count, resume length) for the Task 8 report.

---

### Task 4: Pre-flight seam 2 — Gemini embeddings

- [ ] **Step 1: One-off embed call, assert dimensionality**

```bash
npx tsx -e "import 'dotenv/config'; import { makeGeminiApiEmbedder } from './src/services/embed'; makeGeminiApiEmbedder(process.env.GEMINI_API_KEY!)('smoke test').then(v => console.log('dims:', v.length))"
```

Expected: `dims: 3072`. A `gemini embed failed: 4xx` means key/quota trouble — surface to Rick; nothing downstream works without this.

---

### Task 5: Pre-flight seams 3+4 — app up, n8n→app networking, and agent-key alignment

**Interfaces:**
- Consumes: running stack (Task 2), `.env` (Task 1).
- Produces: dev server on :3000; proof the n8n container can reach it through `host.docker.internal` with a key the app accepts.

- [ ] **Step 1: Start the dev server** — via the `dev` entry in `.claude/launch.json` (preview tooling) or:

```bash
npm run dev
```

Expected: ready on http://localhost:3000.

- [ ] **Step 2: Session auth sanity** — load http://localhost:3000/login, sign in as `rick@sundayaiwork.com` / `change-me-locally`. Expected: lands in the Control Room, no error.

- [ ] **Step 3: Handshake curl from inside the n8n container** (uses the container's own `AGENCY_API_URL` and `AGENT_API_KEY`, exactly as the workflows will):

```bash
docker compose exec -T n8n sh -c 'curl -s -o /dev/null -w "%{http_code}\n" -H "x-agent-api-key: $AGENT_API_KEY" "$AGENCY_API_URL/api/agent/embeddings?subject_type=job_order&subject_id=00000000-0000-0000-0000-000000000000"'
```

Expected: `200` (empty chunks result). `401` → key mismatch: the container's `AGENT_API_KEY` (from `.env` at compose time — re-run `docker compose up -d` after any `.env` change) differs from the app's (`.env.local`/`.env`). Connection refused / `000` → `host.docker.internal` routing problem.

---

### Task 6: The live UI run

**Interfaces:**
- Consumes: everything above green.
- Produces: a completed sourcing run for job `23-00053`, observed live.

- [ ] **Step 1: Open two observation feeds** before clicking: dev-server logs, and n8n executions (http://localhost:5678, or `docker compose logs -f n8n`).

- [ ] **Step 2: Trigger** — as the logged-in user, go to http://localhost:3000/jobs, enter `23-00053` in the JobDiva import form (`SourceFromJobDiva`), submit.

Expected: redirect to `/jobs/<uuid>` for the imported job order; SourcingPanel auto-starts a run.

- [ ] **Step 3: Watch the phases** stream in the panel: `queued → searching_pool → checking_jobdiva` (pool is empty, so the fallback **must** fire) `→ embedding_new → shortlisting → screening → done`, then a ranked shortlist renders. Capture a screenshot at `done`.

- [ ] **Step 4: On failure**, read the layer that broke before touching anything: panel shows `failed` + run `error` → check `sourcing_runs.stats.jobdiva_error` and the n8n execution log for the `Build Shortlist` node; import form 4xx → dev-server log for the `/api/jobs/import` route. Diagnose with superpowers:systematic-debugging, fix, and re-run from Step 2 (re-sourcing is idempotent by design). If JobDiva returned zero candidates for this job's search terms, the run legitimately completes with an empty shortlist — that's a finding, not a failure: get a second job number from Rick and re-run.

---

### Task 7: SQL verification + idempotency re-run

**Interfaces:**
- Consumes: completed run (Task 6).
- Produces: pass/fail per spec criterion, captured outputs for the report.

- [ ] **Step 1: Assert every pass criterion**

```bash
docker compose exec -T db psql -U agency -d agency -c "
select 'job_order' as check, count(*)::text as value from job_orders where jobdiva_id is not null
union all select 'candidates_from_jobdiva', count(*)::text from candidates where jobdiva_id is not null
union all select 'resume_docs', count(*)::text from candidate_documents
union all select 'candidate_embeddings', count(*)::text from embeddings where subject_type = 'candidate_document'
union all select 'job_embedding', count(*)::text from embeddings where subject_type = 'job_order'
union all select 'sourced_applications', count(*)::text from applications where stage = 'sourced'
union all select 'shortlist_decision', state from decisions where action_class = 'source.shortlist'
union all select 'run_phase', phase from sourcing_runs;"
```

Expected: `job_order = 1`; `candidates_from_jobdiva > 0`; `resume_docs > 0`; `candidate_embeddings > 0` (the `halfvec(3072)` column type itself enforces dimensionality, and `content_hash` is NOT NULL — presence of rows proves both); `job_embedding = 1`; `sourced_applications > 0`; `shortlist_decision = executed` (source.shortlist is Tier 1 → auto-approved); `run_phase = done`.

- [ ] **Step 2: Inspect the run stats**

```bash
docker compose exec -T db psql -U agency -d agency -c "select phase, stats from sourcing_runs order by created_at;"
```

Expected: `stats` contains `pool_matches: 0` (recorded pre-fallback), `jobdiva_found > 0`, `jobdiva_new > 0`, `embedded > 0`, `shortlisted > 0`.

- [ ] **Step 3: Idempotency — capture counts, source again, compare**

```bash
docker compose exec -T db psql -U agency -d agency -c "select (select count(*) from candidates) as c, (select count(*) from embeddings) as e, (select count(*) from applications) as a;"
```

Then click **Source candidates** on the same job page; wait for `done`; re-run the same count query and:

```bash
docker compose exec -T db psql -U agency -d agency -c "select phase, stats from sourcing_runs order by created_at desc limit 1;"
```

Expected: two `sourcing_runs` rows total, second `done`; candidate count unchanged (dedupe by `jobdiva_id`); embeddings count unchanged or nearly so (`stats.skipped > 0` — unchanged resumes skip embedding); applications count unchanged (unique `(job_order_id, candidate_id)` upsert).

- [ ] **Step 4: Check Mailpit** (http://localhost:8025) — any communication-agent output stayed local. Note count for the report.

---

### Task 8: Test report + spec status

**Files:**
- Create: `docs/superpowers/reports/2026-07-22-live-sourcing-smoke-test-report.md`
- Modify: `docs/superpowers/specs/2026-07-22-live-sourcing-smoke-test-design.md` (Status line → `Executed <date> — see report`)

- [ ] **Step 1: Write the report** with: environment (commit hash, stack versions), the Task 3 pre-flight numbers, phase timeline observed, the Task 7 SQL outputs verbatim, idempotency deltas, any deviations/fixes made (e.g., JobDiva client shape fixes from Task 3), and open follow-ups (staging-stamp repeat; shortlist-quality judgment from Rick on the real candidates).

- [ ] **Step 2: Update the spec's Status line**, then commit both:

```bash
git add docs/superpowers/reports/2026-07-22-live-sourcing-smoke-test-report.md docs/superpowers/specs/2026-07-22-live-sourcing-smoke-test-design.md
git commit -m "docs: live sourcing smoke test report (JobDiva 23-00053, local stack)"
```

Expected: clean commit on `main`.
