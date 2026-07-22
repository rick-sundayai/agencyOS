# Live sourcing smoke test — Report

**Date:** 2026-07-22
**Spec:** `docs/superpowers/specs/2026-07-22-live-sourcing-smoke-test-design.md`
**Plan:** `docs/superpowers/plans/2026-07-22-live-sourcing-smoke-test.md`
**Verdict: PASS** — the full UI-triggered sourcing flow works end to end against
production JobDiva and live Gemini embeddings. Candidates are found in JobDiva,
inserted, embedded, stored, shortlisted, and screened. Idempotent re-sourcing proven.

## Environment

- Local stack: pgvector Postgres 17 (:5433), n8n 2.6.4 (:5678), Mailpit (:8025),
  `next dev` (:3000). Clean volumes; foundation-only seed + sha256 agent-auth row.
- Repo at commits `1114536` (plan) → `c2827d3`/`e700a00` (fixes made during the test).
- JobDiva: production tenant, read-only (job fetch, JobAgentSearch, resume fetch).
- Test job: `23-00053` — "Product Analyst - Salesforce" (Contract), 4 must-haves.

## Pre-flight results

| Seam | Result |
|---|---|
| JobDiva (production) | After client fixes: `getJob` ✓, `searchCandidates` 1 hit via `JobAgentSearch`, resume text 18,869 chars |
| Gemini embeddings | `dims: 3072` ✓ |
| n8n workflows | 6 imported + active ✓ |
| n8n→app handshake | 200 from inside container with its `AGENT_API_KEY` ✓ |

## Defects found and fixed (this is why the pre-flight approach paid off)

1. **Env var names** — credentials were pasted as `client_id`/`Username`/`PWD`;
   renamed to `JOBDIVA_*`, added `JOBDIVA_BASE_URL`, copied `AGENT_API_KEY` into
   `.env` (docker compose interpolates it into the n8n container from `.env` only).
2. **Missing agent auth row** — `seed.ts` creates no `agents` row, but
   `agent-auth.ts` validates the key against a sha256 hash in that table: on a clean
   DB every `/api/agent/*` call 401s. Plan amended (Task 2 Step 2b) to seed it.
3. **JobDiva client endpoints were fictional** (`7ce0b58`, `6b865e3`, `c2827d3`) —
   the original namespace never existed. Real contracts, verified live and pinned in
   unit tests: `getJob` via BI `JobDetail` (`jobdivaref` param, `{data:[...]}`
   envelope, ALL-CAPS fields); `searchCandidates` rebuilt on
   `/apiv2/jobdiva/JobAgentSearch` (JobDiva's own job→candidate matching; signature
   changed to `searchCandidates(jobNumber, opts?)`); `getResumeText` via
   `CandidateResumesDetail` → `ResumesTextDetail`. Speculative field-name fallbacks
   removed after live shapes were confirmed. 15/15 tests green, `tsc` clean.
4. **Decision transition 400** (`e700a00`) — `n8n/workflows/src/helpers.js` still
   sent `actor` in the transition body; the route now rejects unknown fields
   (`z.strictObject`) and derives the actor from the authenticated agent key. Every
   `completeDecision` 400'd at `executing`. One-line fix.
5. **apply.sh import race (operational)** — right after `node n8n/build.mjs`, the
   container's `/workflows` bind mount can lag on macOS; `import:workflow` then
   silently re-imports the stale build (bit us twice: run 2 failed identically after
   the helper fix was "applied"). Manual re-import + republish + restart resolved it.
   Follow-up suggested below.

## Run history (sourcing_runs)

| Run | Phase | Stats | Note |
|---|---|---|---|
| 1 | failed | pool 0 → jobdiva_found 1, new 1, embedded 1, shortlisted 1 | JobDiva fallback + import + embed all worked; died at decision transition (defect 4) |
| 2 | failed | pool 1, found 1, new 0, embedded 0 | stale workflow build (defect 5) |
| 3 | **done** | pool 1, found 1, new 0, embedded 0, shortlisted 1 | full success; shortlist + screening |
| 4 | **done** | pool 1, found 1, new 0, embedded 0, shortlisted 1 | idempotency re-run via the import form |

## Pass-criteria verification (SQL, scoped to the real org)

| Check | Expected | Actual |
|---|---|---|
| `job_orders` with `jobdiva_id` | 1 | **1** |
| `candidates` with `jobdiva_id` | > 0 | **1** |
| `candidate_documents` (resume) | > 0 | **1** |
| candidate embedding chunks (`halfvec(3072)` enforces dims) | > 0 | **15** |
| job-order embedding | 1 | **1** |
| `applications` at `sourced` | > 0 | **1** |
| `source.shortlist` decision `executed` | yes | **yes** |
| screening `scores` | bonus | **1** (screen.score_resume executed; a `risk.alert` decision is pending in the Cockpit for human disposition) |
| Mailpit messages | local only | **0 sent** — nothing left the machine |

UI: SourcingPanel streamed phases live and rendered the ranked shortlist (1
candidate, cosine distance 0.332); pipeline board shows Sourced = 1.

**Idempotency:** run 4 left candidates/embeddings/applications/job_orders unchanged
(1/16/1/1) — dedupe by `jobdiva_id`, job-embedding hash-skip, and the
`(job_order_id, candidate_id)` upsert all held. Note: `stats.skipped` stayed 0 —
dedupe short-circuits before resume fetch, so the "skipped embedding" counter never
increments; the plan's `skipped > 0` expectation named the wrong mechanism, but the
property it tested is proven by `embedded: 0` + unchanged counts.

## Findings / follow-ups (none blocking)

1. **apply.sh should guard against the bind-mount race** — e.g. compare a content
   hash of `n8n/dist/*.json` against the container's `/workflows` before importing.
2. **Failed runs orphan `approved` decisions** — runs 1–2 left two `source.shortlist`
   decisions stuck at `approved` (workflow died before `completeDecision`). Not in
   the pending queue, but they linger as audit rows; consider failing them with the run.
3. **Vitest writes fixture orgs to the dev DB** — global-count queries are polluted
   by `test-org-*` rows; org-scoped queries required. Fine for dev, worth knowing.
4. **JobAgentSearch returned exactly 1 hit** for this job. Whether that reflects the
   job's niche or a `resumeCount` default worth raising is a product question — Rick
   should judge shortlist quality on a few more jobs.
5. Stale docs reference the old `searchCandidates({title, ...})` signature in
   `docs/superpowers/plans/2026-07-20-sourcing-ui-jobdiva.md` and
   `docs/superpowers/specs/2026-07-20-sourcing-n8n-design.md` (historical docs).
6. **A `risk.alert` decision is pending in the Cockpit** from screening the live
   candidate — awaiting Rick's disposition (expected Tier behavior, and a nice
   end-to-end proof of the Decision model on real data).

## Out of scope (unchanged from spec)

Staging-stamp repeat, scorer calibration (RecruiterPro), JobDiva client-dedupe gap,
automated live e2e.

---

## Enrichment acceptance (2026-07-22, same day — contact enrichment plan)

**Spec:** `docs/superpowers/specs/2026-07-22-jobdiva-contact-enrichment-design.md`
**Commits under test:** `732059d` (client `getCandidateContact`), `388f362` (import enrichment + no-email exclusion).
**Pre-flight (Task 1 probe):** `CandidateDetail` live contract confirmed — param `candidateId`
(camelCase; lowercase 400s), email key `EMAIL`, phone key `CELLPHONE` (no plain `PHONE` key exists;
WORKPHONE/HOMEPHONE empty, PHONE1–4 are typed slots). Test candidate's email: present.

### Run 5 (UI re-source of 23-00053)

Stats: `{pool_matches: 2, jobdiva_found: 1, jobdiva_new: 0, embedded: 0, skipped: 0, no_email: 0, shortlisted: 2}` — phase `done`.

| Check | Expected | Actual |
|---|---|---|
| Email backfilled on the known JobDiva candidate | true | **true** (phone backfilled too, from CELLPHONE) |
| `no_email` stat present in run stats | yes | **yes** (0 — the hit had a usable email) |
| No new "no email on file" `risk.alert` | 0 | **0** |
| `comms.candidate_outreach` decision in Cockpit | yes | **yes** — "Outreach draft for Manrose Sohi — scored 75.6%", Tier 2, auto-approved by policy, 15-min undo window ("Executes in 705s unless cancelled") |
| Mailpit | local only | **0 messages — nothing left the machine** |

### The undo window worked as designed

Rick cancelled the outreach decision from the Cockpit at 10:47:12 UTC, ~6 minutes into the
15-minute undo window (`cancelled_by` = his admin user). The communication workflow therefore
never sent it: Mailpit stayed at 0. **The full outreach chain is verified up to and including
the human gate** — screening drafted real outreach instead of a no-email `risk.alert`, the
Tier-2 policy auto-approved it, the Cockpit displayed it with a live countdown, and a human
cancel inside the window stopped execution. The final send-to-Mailpit leg was deliberately not
exercised this run; re-source and let the window lapse to see the email land.

A second `risk.alert` ("Borderline screen for Embed Target (60%)") also fired — correct
borderline-branch behavior, but for a test-fixture candidate (see finding below).

### New findings

7. **Vitest writes fixtures into the REAL org, not just `test-org-*` orgs.** The 10:36:58–10:37:01
   test window (Task 3's suite) left 10 candidates (Ingest One, Embed Target, Gate Test ×5, …),
   2 QA users, and 16 empty-payload `comms.candidate_outreach` decisions inside 'Sunday AI Work'.
   Live consequences: "Embed Target" entered the sourcing pool, was shortlisted (distance 0.996),
   screened at real Gemini cost, and raised a borderline `risk.alert`; the empty-payload comms
   decisions sit in the Cockpit's auto-exec counter and will fail payload validation if ever picked
   up. Tests must target an isolated DB (or at minimum never the seeded org).
8. **`scripts/jobdiva-smoke.ts:17` prints full candidate objects** (including phone) — violates the
   PII posture the rest of the tooling follows. One-line fix: print field presence only.
9. `getCandidateContact` phone mapping reads `CELLPHONE` only (one-key rule). If a tenant relies on
   PHONE1–4 slots instead, phone enrichment misses — email policy is unaffected.
