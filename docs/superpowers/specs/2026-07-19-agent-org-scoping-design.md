# Agent Org Scoping — Design

## Problem

Every `/api/agent/*` route resolves an authenticated `AgentIdentity` (`{ id, name, org_id }`) via `requireAgentKey(req)` in `src/lib/agent-auth.ts`, but only the transition route (`src/app/api/agent/decisions/[id]/transition/route.ts`) actually uses the resolved identity — for `actor`. The other 13 routes still take `org_id` from client input (a query param on GET routes, a Zod-validated body field on POST routes) and pass it straight through to service-layer DB queries. An agent authenticated for org A can read or write org B's data by simply passing org B's `org_id`.

This is not a regression — the old shared `AGENT_API_KEY` never scoped by org either — but now that `requireAgentKey` resolves a trustworthy `org_id` on every request, the gap is closable with a small, mechanical change.

## Decision

Every route substitutes `auth.org_id` for whatever `org_id` the client supplied, immediately after the existing `if (auth instanceof Response) return auth;` check and before calling into any service function. The client-facing request shape is unchanged — `org_id` stays a required query param / body field, still validated as present exactly as today (missing `org_id` still 400s) — only the *value used downstream* changes from "whatever the client sent" to "the org the authenticated key belongs to." Service-layer function signatures (`proposeDecision`, `getCandidateWithResume`, `searchCandidatesByEmbedding`, `ingestCandidate`, `upsertEmbeddings`, `insertScore`, `insertAgentRun`, `checkCompliance`, `logMessage`, `getConsentStatus`, `getJobOrder`, `listQueue`, `listExecutable`, `getActivePrompt`) are untouched — they still just take an `org_id` string, they now always receive the trustworthy one.

This assumes each agent's API key is scoped to exactly one org for its lifetime — confirmed against the current schema (`agents.org_id` is a single, non-nullable column) and the per-client "stamp" deployment model, where each stamp is an isolated environment with its own `agents` table. No legitimate use case requires a single agent key to act across multiple orgs today.

**Why override rather than validate-and-reject:** a client sending its own correct `org_id` sees zero behavior change either way. Silently overriding avoids a second wire-format break on top of this week's `actor`-field removal on the transition route — every stamp's n8n workflows keep working unmodified, no coordinated payload update required. Validate-and-reject was considered and rejected: it adds a check to every route for no behavioral benefit over override (a mismatch either way means the request never touches the wrong org's data), while introducing a new 403 error path callers would need to handle.

**Why no shared helper or middleware:** the override is a single field substitution with no branching logic — a helper wouldn't meaningfully reduce 14 near-identical one-liners, and middleware would be a heavier architectural addition that breaks the existing convention (established across the whole `/api/agent/*` surface, including this week's per-agent-key work) of testing route handlers directly and in isolation.

## Scope

All 14 `/api/agent/*` routes:

- `src/app/api/agent/candidates/[id]/route.ts` — GET, `org_id` from query param
- `src/app/api/agent/consents/route.ts` — GET, `org_id` from query param
- `src/app/api/agent/decisions/route.ts` — POST + GET (2 call sites)
- `src/app/api/agent/messages/route.ts` — POST, `org_id` inside Zod body (`logMessage`'s schema)
- `src/app/api/agent/job-orders/[id]/route.ts` — GET, `org_id` from query param
- `src/app/api/agent/candidates/route.ts` — POST, `org_id` inside Zod body (`ingestCandidate`'s schema)
- `src/app/api/agent/search/candidates/route.ts` — POST, `org_id` in the route's own `SearchSchema`
- `src/app/api/agent/compliance/check/route.ts` — POST, `org_id` inside Zod body (`checkCompliance`'s schema)
- `src/app/api/agent/embeddings/route.ts` — POST, `org_id` inside Zod body (`upsertEmbeddings`'s schema)
- `src/app/api/agent/scores/route.ts` — POST, `org_id` inside Zod body (`insertScore`'s schema)
- `src/app/api/agent/decisions/executable/route.ts` — GET, `org_id` from query param, currently **optional**: `listExecutable`'s `opts.orgId` is optional, and omitting it today lists executable decisions across *all* orgs. This override removes that capability — after this change, an authenticated request always resolves to exactly `auth.org_id`, with no way to request a cross-org listing through this route. This is intentional and consistent with "one org per agent, always" (confirmed during design), but is called out explicitly here because it's a capability removal, not just a security tightening. If a global cross-org executor genuinely needs to list across all orgs from one agent identity, that's a real conflict with this ADR's core assumption and must be raised before implementation, not discovered during it.
- `src/app/api/agent/runs/route.ts` — POST, `org_id` inside Zod body (`insertAgentRun`'s schema)
- `src/app/api/agent/prompts/route.ts` — GET, `org_id` from query param

Two shapes of override, depending on where `org_id` enters:

- **Query-param routes:** replace `const orgId = url.searchParams.get('org_id');` with `const orgId = auth.org_id;` — the existing `if (!orgId) return ...` check is removed for these (an authenticated request always has an `org_id`; the "org_id required" 400 no longer applies once the client's value is never read).
- **Zod-body routes:** after `const p = Schema.parse(await req.json())`, override with `p.org_id = auth.org_id;` (or construct the service-call input as `{ ...p, org_id: auth.org_id }`) before calling the service function. The Zod schema itself is unchanged — `org_id` stays required in the shape, so a client omitting it still 400s via existing validation; only the parsed value that reaches the service call changes.

## Error Handling

No new error paths. `requireAgentKey`'s existing 401 is unchanged. Each route's existing "missing org_id" validation (400) is unchanged for Zod-body routes; for query-param routes, that check becomes dead code (removed) since `org_id` is no longer read from the client at all. No new 403 or other status code is introduced — an org mismatch is invisible to the caller, not rejected.

## Testing

`decisions/route.test.ts` and `decisions/executable/route.test.ts` (the only 2 of the 14 routes with existing test files) each get one added regression test: call the route with a client-supplied `org_id` that deliberately does not match the seeded test agent's org, and assert the response reflects the *authenticated* org — e.g. a query returns data scoped to the real org, not the claimed one — mirroring the spoofing-prevention test pattern already established for the transition route's `actor` fix.

The other 12 routes have zero existing test coverage. This plan does not backfill full route test suites — that's a separate, much larger concern outside this fix's scope. Instead, each of the 12 gets one new, minimal test file containing just the org-override regression test (seed two agents in two different orgs, call the route as agent A with agent B's `org_id`, assert the result reflects org A) — enough to prove the fix and catch a future regression, without scope-creeping into general coverage.

## Documentation

This change is being recorded as ADR-0006 (`docs/adr/0006-agent-org-scoping.md`) — it's a real, hard-to-reverse trade-off (override vs. reject) affecting authorization behavior across the whole `/api/agent/*` surface, and a future reader would otherwise have to reverse-engineer why client-supplied `org_id` is silently ignored. ADR-0005 explicitly scoped this out as future work; ADR-0006 is that follow-up.
