# 0010: The stamp is the isolation boundary; org_id is an identity-model convention, not a live security control

**Date:** 2026-07-26

**Status:** Accepted

## Context

AgencyOS carries two isolation models at once. `infra/modules/stamp` provisions one GCP project
per client — its own Cloud Run services, Cloud SQL instance, and n8n instance. Simultaneously,
every application table carries `org_id`, with `(org_id, …)` unique constraints, and
ADR-0005/0006/0007 did real hardening work to enforce org scoping through the agent API and the
decision-transition path. Nobody had written down which of the two is actually load-bearing —
`docs/handoffs/2026-07-22-open-work-audit.md` (item 4) records that the stamp architecture never
got its own ADR at all.

Investigation into how `orgs` rows actually come into being found that org creation is not a
product feature: `db/seed.ts` and `db/reseed.ts` each create exactly one org per environment
(`'Sunday AI Work'`), and the only other places an org is inserted are test fixtures deliberately
creating extra orgs to exercise isolation logic. There is no admin UI, no self-service org
creation, and no org-switcher anywhere in the app; a user's `org_id` is fixed at account creation
via `auth.config.ts`. ADR-0009's real-estate vertical bet is realized as a *new stamp*, not a
second org inside an existing one, and the staging-vs-production scenario is already solved by
separate stamps rather than a staging org living alongside a production org.

## Decision

**The stamp is AgencyOS's isolation boundary. `org_id` is kept, but as an identity-model
convention new code must continue to respect — not as a control currently preventing any live
cross-tenant leak.**

Because a stamp holds exactly one org, a query that forgot its `org_id` filter could not leak
data to a second org within that stamp — there is no second org to leak to. The stamp (separate
GCP project, separate Cloud SQL instance, separate n8n instance) is what actually keeps one
client's data from another's. `org_id` is not doing that job today.

We chose to keep `org_id` and its enforcement anyway, for reasons unrelated to live security:

- **Identity-model correctness.** `users.org_id` and `agents.org_id` record a real fact — which
  org an actor belongs to — independent of whether that fact is currently load-bearing for
  isolation.
- **Already hardened, cheap to keep.** ADR-0005/0006/0007 built and tested this enforcement
  across 14 agent routes plus the transition path. Removing it is real, risky work — touching
  every route, query, and test — for zero present-day benefit; leaving it alone costs nothing.
- **New code must keep filtering by `org_id`**, same as the ADR-0006/0007 precedent, even though
  the filter is currently redundant for security. The marginal cost of the filter is close to
  zero (an org-scoped query already needs a `WHERE` clause to make sense), and dropping the
  discipline in new code would plant a landmine: if a stamp ever does end up holding a second
  org, any code written under a "stamp isolation is enough" rule becomes a silent live leak with
  no compensating control. We are explicitly *not* leaning on a hypothetical future franchise or
  multi-brand customer as the justification here — the wayfinder map's own "out of scope" section
  already rules out cross-stamp/cross-tenant concerns for this effort — this is a minor
  tie-breaker, not the reason for the decision.

## Consequences

**Positive:**
- Closes the audit gap: the stamp is now explicitly named as the isolation boundary, with an ADR
  behind it.
- No code changes required — ADR-0005/0006/0007's enforcement work is preserved as-is.
- Keeps future optionality cheap: if a multi-org-per-stamp customer ever appears, the isolation
  model requires no schema or query migration to support it.

**Negative / trade-offs:**
- Every new agent or human-facing route must remember to filter by `org_id` even though, in
  today's one-org-per-stamp reality, that filter is provably redundant for security — an ongoing
  discipline cost for a control that isn't currently live.
- A future reader may reasonably ask why the pattern is kept when it prevents nothing today; this
  ADR is the answer to that question, and should be linked wherever the question resurfaces.

**Neutral:**
- This ADR changes no code. It resolves which of two coexisting isolation models is load-bearing
  and records the rationale for keeping the other.
