# Decision-Transition Org Scoping — Design

## Problem

ADR-0006 scoped all 14 `/api/agent/*` routes that read or write decisions (and other org-owned data) to `auth.org_id`, the org resolved from the caller's authenticated agent identity (`requireAgentKey` in `src/lib/agent-auth.ts`). One route was explicitly excluded from that work: `src/app/api/agent/decisions/[id]/transition/route.ts`. It doesn't take a client-supplied `org_id` at all — it identifies the decision purely by its UUID path segment — so ADR-0006's "override the client-supplied value with `auth.org_id`" pattern didn't apply.

That exclusion left a real gap. `transitionDecision(id, to, actor, extras)` in `src/services/decision-store.ts` (lines 47-84) fetches the decision with `eq(decisions.id, id)` alone and updates it with the same predicate plus a compare-and-swap on `state`. No `org_id` filter exists anywhere in the call chain. Nothing else in the system compensates: `src/middleware.ts` explicitly excludes `/api/agent/*` from its session-auth matcher (agent routes are API-key-authed only, not session-scoped), and no Postgres row-level security policies exist anywhere in `src/db`. An agent authenticated for org A that obtained org B's decision UUID by any means could transition org B's decision — recorded with org A's agent as `actor`.

Practical exploitability is low today: `decisions.id` is a random `gen_random_uuid()` (unguessable), and every listing/read endpoint an agent can legitimately call is now org-scoped per ADR-0006, so there's no current API path for an org-A agent to learn an org-B UUID. But it's a real defense-in-depth gap and directly contradicts the trust model ADR-0006 just established (authorize by `auth.org_id`, never by an unscoped identifier alone) — a future leak elsewhere (logs, a webhook payload, a bug) would make it exploitable.

**A second caller has the identical gap.** `transitionDecision` has two call sites, not one: the agent route above, and `src/app/queue-actions.ts:35` (`approveDecisionAction` / `cancelDecisionAction`), used by the human-facing dashboard. Its `requireCanAct` helper (lines 14-26) checks the caller's session and role/tier against the decision, but never checks the decision's `org_id` against the session's org. Human sessions carry a single `org_id` too (`session.user.org_id`, set in `src/lib/auth.config.ts:22`, same one-org-per-identity model as agents) — and `src/app/page.tsx:14` already scopes the dashboard's decision *listing* to `session.user.org_id` via `listQueue`, confirming this is the established org boundary for human users, just not enforced on the mutation path. This is the same defect reached through a second door, so this ADR fixes both callers together rather than leaving one half-patched.

## Decision

Add `orgId: string` as a new, required parameter to `transitionDecision`, positioned after `actor` (`transitionDecision(id, to, actor, orgId, extras)`). Filter both the initial `SELECT` and the compare-and-swap `UPDATE` by `eq(decisions.org_id, orgId)` in addition to the existing predicates.

On an org mismatch, throw the exact same error message already thrown for a genuine miss — `` `Decision not found: ${id}` `` — rather than a distinct message or status code. This avoids confirming a resource's existence to an unauthorized caller, and requires no new error-handling branches in either caller beyond passing the new argument through:

- The agent route (`src/app/api/agent/decisions/[id]/transition/route.ts`) passes `auth.org_id` (already resolved by the existing `requireAgentKey` call): `transitionDecision(id, body.to, auth.name, auth.org_id, { error: body.error, outcome: body.outcome })`. Its existing catch block already maps `Decision not found` to a 404 response — no change needed there.
- `queue-actions.ts`'s `requireCanAct` already fetches the decision via `getDecision(id)` and the session via `auth()`. It gains one more check — `decision.org_id !== session.user.org_id` throws the same `` `Decision not found: ${id}` `` message used for a missing decision, immediately after the existing not-found check (lines 17-18), before the role/tier check. `requireCanAct` returns `session.user.org_id` alongside the existing `userId`, and `approveDecisionAction`/`cancelDecisionAction` pass it through `transitionOrFriendlyError` into `transitionDecision`. No new error message or UI branch — a cross-org attempt (not reachable through the dashboard's own org-scoped listing today, same defense-in-depth reasoning as the agent side) surfaces as the same "Decision not found" error the UI already handles for a stale/deleted decision.

**Why this needs its own ADR (0007) rather than folding into ADR-0006:** ADR-0006's 14 routes all already took `org_id` as an existing parameter (client-supplied, then overridden) — no signature changed, and behavior only changed for callers sending a *mismatched* `org_id` (an edge case, arguably already a bug on their end). This change adds a wholly new required parameter to a shared service function with two call sites and changes behavior for any caller — a currently-succeeding cross-org transition attempt (from either the agent API or the human dashboard) will start failing with "not found." That combination (hard to reverse once both callers depend on the new signature, surprising to a future reader who doesn't know why a plain "transition by ID" function takes an org, and a genuine trade-off on indistinguishable-404 vs. a distinct error) meets the same bar ADR-0005 and ADR-0006 used.

## Error Handling

No new status codes or error messages on either path. The agent route's existing 401/400/409/404 responses are unchanged; an org mismatch folds into the existing 404 path via the shared error message. `queue-actions.ts` has no HTTP status codes (it's a Next.js server action) — a cross-org attempt throws the same `Decision not found: ${id}` error the UI already surfaces for a stale decision, no new catch branch required.

## Testing

Two new regression tests, one per caller:

- Agent route (`src/app/api/agent/decisions/[id]/transition/route.test.ts`): seed two agents in two different orgs (`seedTestAgentInFreshOrg`, already available from ADR-0006's work), propose a decision as org A's agent, then attempt to transition it via org B's agent's API key. Assert the response is 404 (not 200, not 409, not 500), and assert the decision's state in the database is unchanged from its pre-attempt value.
- `queue-actions.ts` (new or existing test file, whichever the codebase already uses for this module — the plan will confirm during Task 1): seed a decision under org A, mock/construct a session for a user in org B, call `approveDecisionAction` (or `cancelDecisionAction`), assert it throws `Decision not found: ${id}`, and assert the decision's state is unchanged in the database.

## Scope

Three source files change, plus their test files:

- `src/services/decision-store.ts` — add the required `orgId` parameter to `transitionDecision`, add the `org_id` filter to both the `SELECT` and the compare-and-swap `UPDATE`.
- `src/app/api/agent/decisions/[id]/transition/route.ts` — pass `auth.org_id` as the new argument.
- `src/app/queue-actions.ts` — `requireCanAct` gains the org-mismatch check and returns `orgId`; both exported actions pass it through to `transitionDecision`.
- The transition route's existing test file and `queue-actions`'s test coverage each gain one new cross-org regression test as described above.

These are the only two callers of `transitionDecision` (confirmed by grep during investigation), so no other call sites need updating.
