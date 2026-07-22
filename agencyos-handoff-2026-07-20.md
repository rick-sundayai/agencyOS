> **Update (2026-07-22): superseded.** The plan described below was fully executed — all 13 tasks
> landed on `main` between commits `5aa529e` and `1f7f4ef` (through 2026-07-21), including the
> JobDiva client, sourcing-runs table/service, live Sourcing panel, and Playwright e2e coverage.
> The "Current state" and "Next steps" sections below are historical (written right after planning,
> before execution began) — do not treat them as current. See `docs/handoffs/` for what shipped
> after, and `git log --oneline` for the authoritative record. Left in place for context only.

# Handoff: AgencyOS — UI-triggered sourcing with JobDiva fallback — 2026-07-20

## Context

AgencyOS is a "Control Room" recruiting app (Next.js 16 + Drizzle/pgvector + n8n agent workflows) where an operator supervises autonomous recruiting agents. This session brainstormed, spec'd, and planned the next feature: recruiters trigger candidate sourcing from the UI — either by entering a JobDiva job number on `/jobs` (importing the job if missing) or clicking **Source candidates** on `/jobs/[id]`. The click fires the existing n8n sourcing webhook; the workflow searches the internal candidate pool first, falls back to JobDiva only when internal results are thin, embeds only new/changed candidates, auto-creates `sourced`-stage Applications, and streams phase progress + the ranked shortlist back onto the job page via a new `sourcing_runs` table the page polls.

## Current state

- **Done:** design brainstormed (all decisions user-approved section by section), spec written and committed, 13-task implementation plan written and committed. Working tree is clean on `main`.
- **In progress / next:** implementation has NOT started. The session ended right after offering the execution choice (subagent-driven vs. inline); the user has not picked one yet.
- **Blocked:** nothing. One known verify-at-build item: real JobDiva REST endpoint paths/shapes must be checked against JobDiva's live API docs during plan Task 6 (the plan's `ENDPOINTS` map is best-known-guess; the exported client interface is the fixed contract).

## Key decisions

- **Approach C (of three considered):** orchestration stays in n8n; every capability is a tested TypeScript service behind `/api/agent/*` (agent-key auth) or new `/api/jobs/*` (session auth). Matches how all five existing workflows already work; keeps the hairy JobDiva integration unit-testable.
- **Entry points: both** — JobDiva job-number import form on `/jobs` (redirects to `/jobs/[id]?source=1`, panel auto-fires) AND a Source button/panel on the job detail page.
- **JobDiva policy: internal-first.** JobDiva is called only when fewer than `MIN_GOOD_MATCHES = 10` results under cosine distance `MAX_DISTANCE = 0.55`; per-job targeted search (title + must-haves), resumes fetched only for new/doc-less candidates, capped at 25/run. JobDiva failure is soft (run continues internal-only, `stats.jobdiva_error` recorded).
- **Results UX: live on the job page** via a new `sourcing_runs` table (phases `queued → searching_pool → checking_jobdiva → embedding_new → shortlisting → screening → done | failed`), 2.5 s polling (deliberately not SSE), 10-minute staleness guard, one non-terminal run per job (409).
- **Shortlist → pipeline:** every shortlisted candidate auto-becomes a `sourced`-stage Application (`onConflictDoNothing`); the `source.shortlist` Decision still lands in the Cockpit.
- **Job embeddings are stored and reused** (new GET on `/api/agent/embeddings` + `content_hash` compare) so re-sourcing an unchanged job costs no Gemini call.
- **Testing includes Playwright (new to repo, user-requested):** two e2e journeys with n8n + JobDiva stubbed by a single fixture server (`scripts/e2e/fake-n8n.mjs`, port 5679); login via seeded dev credentials.
- **Git workflow:** commit straight to `main` after every task (solo dev, per user memory).

## Artifacts

- Spec: `docs/superpowers/specs/2026-07-20-sourcing-n8n-design.md` (commit `a0d15cb`)
- Plan: `docs/superpowers/plans/2026-07-20-sourcing-ui-jobdiva.md` (commit `b826c05`) — 13 TDD tasks with complete code, file paths, commands
- Domain vocabulary: `CONTEXT.md` (Cockpit/Decision/Stage glossary; plan Task 13 adds a "Sourcing run" entry)
- Existing pieces the plan builds on: `n8n/workflows/src/sourcing.workflow.mjs`, `src/services/{ingest,embed,matching}.ts`, `src/lib/agent-auth.ts`, `src/test-support/seed-agent.ts`
- Recent commits: `git log --oneline -5`

## Next steps

1. Ask the user which execution mode they want for the plan: subagent-driven (recommended in-session offer) or inline via executing-plans.
2. Execute the plan task-by-task in order (Tasks 1–13). Each task is self-contained: failing test → implement → pass → commit to `main`.
3. During Task 6, verify the JobDiva `ENDPOINTS` map + response mappers against the account's live JobDiva API docs and run `npx tsx scripts/jobdiva-smoke.ts <job-number>` with real creds (`JOBDIVA_*` in `.env.local`); if creds aren't available, note the deferral and continue — unit tests pin the contract.
4. During Task 12, verify the fixture payloads in `scripts/e2e/fake-n8n.mjs` against the real decisions/candidates route schemas, and the login-page locators, as flagged in the plan.
5. After Task 13's full verification pass (`npm test`, `npx tsc --noEmit`, `npm run lint`), do an end-to-end manual check with docker n8n running (`node n8n/build.mjs && ./n8n/apply.sh`, then click Source on a job).

## Suggested skills

- `superpowers:subagent-driven-development` or `superpowers:executing-plans` — required by the plan header; pick per the user's answer to step 1.
- `superpowers:test-driven-development` — every plan task is written red-green; hold that discipline.
- `superpowers:verification-before-completion` — run the stated commands before claiming any task done.
- `superpowers:systematic-debugging` — if the n8n shell test or Playwright specs fail (the two spots touching live infrastructure).
