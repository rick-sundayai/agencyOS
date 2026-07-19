# Handoff: AgencyOS — 2026-07-19 (agent org-scoping + transition-route fix, merged and pushed)

## Context

AgencyOS is a Next.js 16 / Drizzle / Postgres agentic recruiting system, deployed per-client as an isolated "stamp" (own GCP project, own n8n instance, own DB). This session closed out a chain of three authorization gaps in the `/api/agent/*` surface and the decision state machine, each formalized as an ADR, planned, and built via `superpowers:subagent-driven-development`. All work is merged to `main` and pushed to `origin/main` at `619d116`.

The chain started from a stale handoff doc review, which led to picking "per-agent API keys" (ADR-0005, already merged before this session) as the first fix. Reviewing that work surfaced a follow-up gap (client-supplied `org_id` trusted instead of the authenticated agent's org — ADR-0006), and reviewing *that* work surfaced a third, narrower gap in the decision-transition path specifically (ADR-0007).

## Current state

**Done, merged, pushed — nothing in progress or blocked.**

- ADR-0005 (per-agent API keys): merged in an earlier session, not part of this one's changes but load-bearing context (`requireAgentKey` → `AgentIdentity { id, name, org_id }`).
- ADR-0006 (agent org scoping): all 14 `/api/agent/*` routes now derive `org_id` from `auth.org_id` instead of trusting client input. 5-task plan, each task implemented + reviewed clean, final whole-branch review approved. Merged to `main` at `b6474f1`.
- ADR-0007 (transition-route org scoping): `transitionDecision` (`src/services/decision-store.ts`) now requires and enforces an `org_id` parameter, closing the one route ADR-0006 explicitly excluded (it takes no client `org_id`, only a decision UUID). Investigation during design found a **second caller** with the identical gap — `src/app/queue-actions.ts`, the human dashboard's server actions — and this ADR fixed both in one pass. 3-task plan, each task implemented + reviewed clean, final whole-branch review approved. Merged to `main` at `619d116`, then pushed to `origin/main`.

Working tree has pre-existing, unrelated uncommitted state that predates this session (present at session start, left untouched throughout): a modified `scripts/migration/backfill-embeddings.test.ts` and several untracked `AgencyOS-handoff-*.md` files at the repo root. Not part of this session's work — the next agent should investigate before assuming ownership.

## Key decisions

- **Override, not reject, on org mismatch** (ADR-0006 and ADR-0007 both): a client-supplied `org_id` that doesn't match the authenticated agent's org is silently replaced with the correct one (routes) or surfaces as an indistinguishable "not found" (transition/queue-actions), never a distinct 403. Rationale: avoids a second wire-format break for existing n8n callers, and doesn't confirm cross-org resource existence to an unauthorized caller.
- **`transitionDecision`'s `orgId` is required, not optional** (ADR-0007) — deliberately, so no caller (including a future one) can silently skip the check. This is why both callers needed updating together in one ADR rather than shipping the agent-route fix alone.
- **Same "not found" message for missing vs. wrong-org** (ADR-0007): a cross-org attempt on `transitionDecision` throws the identical `` `Decision not found: ${id}` `` used for a genuinely missing row — no new error type or status code anywhere in either caller.
- **`decisions/executable`'s previously-optional `org_id` was made mandatory** (ADR-0006) — a deliberate capability removal (it used to allow listing across all orgs when omitted), documented explicitly since it changes existing behavior, not just tightens it.
- Two worktrees in this session were created via `EnterWorktree` with the default `baseRef: "fresh"`, which branches from `origin/main` — since local `main` was repeatedly ahead of `origin/main` (unpushed commits from prior sessions), each worktree required an explicit `git merge main` after creation to pull in dependencies, plus manual copying of `.env`/`.env.local` (git-ignored, not present in a fresh worktree) before tests would run. Now moot since `origin/main` is caught up, but worth knowing if it recurs.

## Artifacts

- ADR-0005: `docs/adr/0005-per-agent-api-keys.md`
- ADR-0006: `docs/adr/0006-agent-org-scoping.md`
- ADR-0007: `docs/adr/0007-transition-org-scoping.md`
- Design specs: `docs/superpowers/specs/2026-07-19-agent-org-scoping-design.md`, `docs/superpowers/specs/2026-07-19-transition-org-scoping-design.md`
- Plans: `docs/superpowers/plans/2026-07-19-agent-org-scoping.md`, `docs/superpowers/plans/2026-07-19-transition-org-scoping.md`
- Recent commits: `git log --oneline -13` (from `98eb6be` through `619d116`) covers this session plus the immediately-preceding per-agent-key work
- Test suite: 242/242 passing on `main` as of `619d116` (one known intermittent flake in `scripts/migration/backfill-embeddings.test.ts`, confirmed unrelated and pre-existing — passes in isolation)

## Next steps

1. No open work from this chain — ADR-0005/0006/0007 together closed every known unscoped read/write/mutate path on agent-owned and decision data that was reachable via `/api/agent/*` or the human dashboard's server actions.
2. If picking this domain back up, the final whole-branch review of ADR-0007 flagged one **pre-existing, out-of-scope** note worth a future look: `listExecutable` (`src/services/decision-store.ts`) still has an *optional* `orgId` parameter — its only current caller passes `auth.org_id`, but the function itself would silently allow a future caller to omit it and read cross-org. Not urgent (a read, not a mutation), but the ADR-0006 claim that "every read is org-scoped" is only true by caller discipline, not by the function's own signature.
3. Investigate and either commit or discard the pre-existing uncommitted state in the working tree (see Current State) — it's unrelated to this session and was intentionally left alone.
4. The `AgencyOS-handoff-*.md` files accumulating at the repo root (including this one) are untracked scratch documents from multiple sessions — consider whether they should be gitignored, moved to a `docs/handoffs/` directory, or periodically pruned.

## Suggested skills

- `superpowers:brainstorming` — use before any new feature or fix work; this session's whole chain followed brainstorm → ADR → plan → subagent-driven-development, and that discipline is what caught the second `transitionDecision` caller before it shipped half-fixed.
- `superpowers:subagent-driven-development` — the established execution pattern for multi-task plans in this repo; mirrors exactly what both ADR-0006 and ADR-0007 used (worktree → per-task implementer + reviewer → final whole-branch review → finishing-a-development-branch).
- `superpowers:finishing-a-development-branch` — for merging/cleaning up any future worktree in this repo; watch for the `EnterWorktree` stale-`origin/main` issue noted above.
