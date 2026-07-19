# 0006: Override client-supplied org_id with the authenticated agent's org on every /api/agent/* route

**Date:** 2026-07-19
**Status:** Accepted

## Context

[ADR-0005](0005-per-agent-api-keys.md) replaced the single shared `AGENT_API_KEY` with per-agent keys, giving `requireAgentKey` (`src/lib/agent-auth.ts`) a resolved `AgentIdentity` (`{ id, name, org_id }`) on every authenticated request. That work deliberately scoped itself to authentication only — only the transition route was updated to use the resolved identity (for `actor`). The other 13 `/api/agent/*` routes still take `org_id` from client input (a query param or a Zod-validated body field) and pass it straight through to service-layer DB queries. An agent authenticated for org A can read or write org B's data by simply passing org B's `org_id` in the request. This was not a regression introduced by ADR-0005 — the old shared key never scoped by org either — but ADR-0005 noted that once a trustworthy `org_id` exists per request, closing this gap becomes straightforward, and left it as explicit future work.

Each agent's API key is scoped to exactly one org for its lifetime (`agents.org_id` is a single, non-nullable column), and the per-client "stamp" deployment model means each stamp is an isolated environment with its own `agents` table — there is no case today where a single agent key needs to act across multiple orgs.

## Decision

Every `/api/agent/*` route substitutes `auth.org_id` (the authenticated identity's org) for whatever `org_id` the client supplied, immediately after resolving `auth` and before calling any service function. The client-facing request shape is unchanged — `org_id` remains a required parameter, still validated as present exactly as before — only the value actually used downstream changes.

We chose silent override over validating the client-supplied `org_id` and rejecting a mismatch with 403. A client sending its own correct `org_id` sees no behavior change under either approach; the difference only shows up for a client sending the wrong one, and override handles that case with zero wire-format impact — every stamp's existing n8n workflows keep working unmodified, with no second coordinated payload update required on top of this week's `actor`-field removal on the transition route. Validate-and-reject would add a check to every route for no additional protection (a mismatch never reaches the wrong org's data either way) while introducing a new error path callers would need to handle.

We did not introduce a shared helper function or Next.js middleware for the override. The change is a single field substitution with no branching logic — a helper would not meaningfully reduce 14 near-identical one-line edits — and middleware would break the established convention (through both ADR-0005 and this change) of testing route handlers directly and in isolation.

## Consequences

**Positive:**
- Closes the cross-org data access gap on all 14 `/api/agent/*` routes with no request-shape changes and no operator rollout coordination.
- Every route now trusts only the authenticated identity for authorization scope, matching the transition route's precedent for `actor`.

**Negative / trade-offs:**
- A client sending a mismatched `org_id` gets no error signal — the request silently succeeds against the correct org instead of the one it claimed. This could mask an integration bug on the caller's side (e.g. a misconfigured workflow sending the wrong org_id would appear to work, scoped to a different org than intended, rather than failing loudly).
- The "org_id required" client-side validation on query-param routes becomes structurally redundant (present only for wire-format stability, not for authorization) — a maintenance footgun if a future editor assumes that validation still serves an authorization purpose.
- 12 of the 14 routes had no test coverage before this change; this ADR's fix adds one minimal regression test per route but does not establish full test coverage for those routes.

**Neutral:**
- Assumes one org per agent for the lifetime of a key. If a future requirement needs a single agent to act across multiple orgs, this decision must be revisited — the override pattern has no room for that without a different identity model.
