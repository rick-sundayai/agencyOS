# Phase 1c — Agent Runtime: Implementation Design

## Context

Plans 1a (foundation) and 1b (cockpit) are complete and merged to `main`: decision store,
Zod contracts, state machine, session auth, SSE queue, ATS view queries — 
[decision-store.ts](../../../src/services/decision-store.ts),
[contracts/decision.ts](../../../src/contracts/decision.ts),
[contracts/transitions.ts](../../../src/contracts/transitions.ts).

Phase 1c is fully specified in a separate, already-detailed step-by-step plan in the sibling
knowledge-hub repo:
`Agentic_Recruiting/01-architecture/phase1c-agents-plan_2026-07-09.md`
(spec: `Agentic_Recruiting/01-architecture/agentic-agency-greenfield-design_2026-07-09.md`).
That document covers all 13 tasks — the `/api/agent/*` execution-lifecycle, comms, compliance,
ingest, and matching APIs; the scorer asset port (v2.2.0 + C01 hard gate); n8n + Mailpit infra;
and five workflows (Orchestrator, Data Steward, Sourcing, Screening, Communication) — with
working code and TDD steps for each.

## Decision: adapt Plan 1c, don't re-derive it

A review against the current AgencyOS code turned up a regression and two small
inconsistencies (below), but the architecture, task breakdown, and code in Plan 1c are sound
and match the current schema almost exactly (all tables Tasks 2–6 need — `agent_runs`,
`conversations`, `messages`, `consents`, `system_prompts`, `embeddings` w/ halfvec(3072) +
hnsw, `scores`, `candidate_documents` — already exist and are migrated). Re-brainstorming the
design from scratch would discard work that's still correct. This spec's job is to name the
deltas, not restate the plan.

Rejected alternatives: splitting into "API surface now / n8n later" (the tasks are
sequential enough — later workflows depend on earlier API routes — that a phase split adds
process overhead without reducing risk); re-deriving the design fresh (no open design question
remains that the existing plan gets wrong).

## Corrections to apply

1. **`transitionDecision` (Task 1, Step 2)** — Plan 1c's replacement snippet drops the
   existing ADR-0003 compare-and-swap guard at
   [decision-store.ts:70-75](../../../src/services/decision-store.ts:70). The implementation
   plan must extend that function in place — add `extras: { error?, outcome? }` and the
   corresponding patch fields — without touching the existing
   `.where(and(eq(decisions.id, id), eq(decisions.state, from)))` guard or the "already
   transitioned by another process" throw. Task 1 Step 4's own concurrent-transition test, and
   Task 12's per-decision try/catch, both depend on that guard still being there.
2. **`embeddings.subject_type` naming** — schema comment at
   [intelligence.ts:16](../../../src/db/schema/intelligence.ts:16) says
   `'candidate_chunk' | 'job_order'`; Plan 1c's ingest/matching code reads and writes
   `'candidate_document'`. Nothing in the DB enforces either string (it's a bare `text`
   column), so keep the plan's `'candidate_document'` (it matches what `subject_id` actually
   points to) and update the schema comment to match, rather than introduce a third name.
3. **`docker-compose.yml` n8n service** — Plan 1c hardcodes
   `AGENT_API_KEY=dev-agent-key-change-me` as a literal in the n8n service block, while
   `GEMINI_API_KEY=${GEMINI_API_KEY}` on the next line correctly interpolates from `.env`.
   Change `AGENT_API_KEY` to interpolate too (`${AGENT_API_KEY}`), so it can't drift from what
   `getEnv('AGENT_API_KEY')` checks in `requireAgentKey` and silently 401 every agent call.
4. **Existing `/api/agent/decisions/route.ts`** duplicates the auth check
   ([route.ts:5-10](../../../src/app/api/agent/decisions/route.ts:5)) that Task 1's new
   `src/lib/agent-auth.ts#requireAgentKey` formalizes. Fold this route over to the shared
   helper while adding it, so there's one auth check in the codebase, not two.
5. **n8n image version** — pin `n8nio/n8n` to a specific recent tag instead of `:latest` in
   the compose file. Plan 1c's own inline notes flag several version-dependent behaviors to
   verify at build time (`import:workflow` custom ids, `$env` access gating, `crypto` builtin
   allowlisting) — pinning keeps that verification from silently going stale if Docker pulls a
   newer image mid-implementation.

## Execution strategy

- **One implementation plan**, not split — mirrors Plan 1c's 13 tasks in order (API surface →
  scorer port → n8n infra → 5 workflows → e2e), each keeping its existing TDD steps (failing
  test → implement → pass → commit).
- **Isolated git worktree** for the work, given its size (13 tasks, ~14 new files, new Docker
  services, edits to `.env`/`docker-compose.yml`/`vitest.config.ts`) — keeps `main` clean if
  the work needs to pause partway through.
- **Task-by-task execution with a commit after each**, per Plan 1c's own header instruction
  (`subagent-driven-development` recommended, `executing-plans` as fallback). The tasks are
  mostly sequential (Tasks 8–12 depend on Task 7's infra; the workflows depend on Tasks 1–6's
  routes), so parallelism is limited, but each task still gets a checkpoint.
- **Golden-path tests run for real** — a working `GEMINI_API_KEY` and a working local Docker
  setup are both confirmed available, so Tasks 6 and 9–13's live-model golden scripts are
  actually run and verified, not deferred to a later pass.

## Confirmed constraints

- `GEMINI_API_KEY`: available, will be added to `.env`.
- Docker / Docker Compose: installed and already running Postgres for this project.
- Plan 1c source document (`Agentic_Recruiting/01-architecture/phase1c-agents-plan_2026-07-09.md`)
  will be patched with corrections 1–3 above so it stays accurate as a historical record (that
  repo has no git history to commit against — it's a plain directory, not a git repo).

## Out of scope (deferred, per Plan 1c's own self-review)

External sourcing channels (LinkedIn/SMS/voice), LLM-based signal classification, retry
orchestration beyond per-item try/catch, and SES (real email transport) — all Plan 1d.
