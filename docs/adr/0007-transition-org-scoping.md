# 0007: Require and enforce org_id in transitionDecision

**Date:** 2026-07-19
**Status:** Accepted

## Context

[ADR-0006](0006-agent-org-scoping.md) scoped all 14 `/api/agent/*` routes that read or write decisions to the authenticated agent's `auth.org_id`, closing a cross-org data access gap. One route was explicitly excluded from that work: the decision-transition route (`src/app/api/agent/decisions/[id]/transition/route.ts`). It identifies its target purely by the decision's UUID path segment, taking no `org_id` at all, so ADR-0006's "override the client-supplied org_id" pattern didn't apply.

That exclusion left `transitionDecision` (`src/services/decision-store.ts`) with no `org_id` check anywhere in its lookup or update — an agent authenticated for org A that obtained org B's decision UUID by any means could transition org B's decision. Nothing else compensated: `src/middleware.ts` excludes `/api/agent/*` from session-auth entirely, and no Postgres row-level security exists in this codebase.

Investigation also found a second, structurally identical caller: `src/app/queue-actions.ts`'s `requireCanAct`, used by the human-facing dashboard's `approveDecisionAction`/`cancelDecisionAction` server actions. It checks the session and the caller's role/tier against the decision, but never checked the decision's `org_id` against `session.user.org_id` — despite the dashboard's own listing (`src/app/page.tsx`) already scoping to `session.user.org_id`, confirming that boundary is the established org scope for human users too.

Practical exploitability was low in both cases — `decisions.id` is an unguessable `gen_random_uuid()`, and every legitimate listing path (agent or human) is already org-scoped — but the gap directly contradicted the trust model ADR-0006 established, and a future leak elsewhere (logs, a bug, a webhook payload) would have made it exploitable.

## Decision

`transitionDecision` now takes a required `orgId: string` parameter and filters both its `SELECT` and its compare-and-swap `UPDATE` by `org_id`. On a mismatch, it throws the exact same `` `Decision not found: ${id}` `` message already used for a row that doesn't exist at all — a wrong-org caller cannot distinguish "this decision doesn't exist" from "this decision exists, but not in your org." No new error message, exception type, or HTTP status code was introduced.

Both callers were updated together, since this is the same defect reached through two doors:
- The agent route passes `auth.org_id`, already resolved by its existing `requireAgentKey` call.
- `queue-actions.ts`'s `requireCanAct` gained an org check (`decision.org_id !== session.user.org_id` throws the same not-found message) and now returns `orgId` alongside `userId`, threaded through to `transitionDecision`.

We chose a required parameter over an optional one specifically to force every caller to supply an org — an optional `orgId` that silently skips the check when omitted would have left the human-dashboard path unfixed by default, defeating the purpose of the change.

## Consequences

**Positive:**
- Closes the last unscoped mutation path on the `decisions` table — every read, list, and write is now org-scoped by an authenticated identity, matching ADR-0006's trust model.
- Fixes the gap on both the agent API and the human dashboard in one coherent change, rather than leaving one half-patched.

**Negative / trade-offs:**
- A cross-org attempt (from either caller) now surfaces as "not found" rather than any more specific signal — consistent with ADR-0006's precedent, but it means a legitimately misconfigured caller (e.g. a bug passing the wrong decision ID) gets the same generic message as an authorization failure, which could be marginally harder to debug from the caller's side.
- `transitionDecision`'s signature is now a required 4-argument (plus optional 5th) function; any future caller must supply an org, which is the intended friction but is a small ergonomic cost.

**Neutral:**
- This is the last of the three ADRs (0005, 0006, 0007) closing gaps opened by the original shared-API-key model; no further known gaps in the `/api/agent/*` or decision-mutation surface remain as of this writing.
