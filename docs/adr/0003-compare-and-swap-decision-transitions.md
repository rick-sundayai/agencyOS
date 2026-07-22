# 0003: Compare-and-swap on `decisions.state` (and `org_id`) for every transition

**Date:** 2026-07-13 (implemented); recorded retroactively 2026-07-22 — this decision has been
cited as "ADR-0003" in code comments, tests, and plan docs since it was written, but the file
itself was never created. Backfilled now to close that gap; no change in substance.

**Status:** Accepted

## Context

`transitionDecision` (`src/services/decision-store.ts`) is a read-then-write: it selects the
current row, checks the transition is legal (`canTransition`), then updates it. More than one
actor can race on the same Decision — a human clicking Undo at the same moment a capability
agent's executor (Plan 1c) picks the same Decision up as executable, for example. Without a
guard, whichever write lands second silently overwrites the first, and the loser's caller has
no way to know its action didn't actually happen.

## Decision

The update is a compare-and-swap on the DB row, not an application-level lock: `UPDATE
decisions SET ... WHERE id = :id AND org_id = :orgId AND state = :expectedFromState`. If zero
rows come back, another process already moved the row out from under this caller, and
`transitionDecision` throws (originally a bare `Error`, now `ConcurrentTransitionError` — see
the 2026-07-22 typed-errors refactor) instead of silently reporting success on a write that
never happened.

Callers are expected to treat this as a distinct, non-fatal outcome — not a 500. The
`/api/agent/decisions/[id]/transition` route maps it to `409`; `queue-actions.ts` catches it
and surfaces a friendly "already handled — refresh the queue" message instead of the raw error;
Plan 1c's batch executor wraps each decision's processing in its own try/catch specifically so
one lost race doesn't throw out of the loop and starve every decision queued behind it.

`org_id` is included in the `WHERE` alongside `state` for the same reason it's included on
every other decision-store query: a caller from the wrong org gets "not found," never a
different org's row.

## Consequences

**Positive:**
- No lost updates: a losing racer always finds out, instead of silently losing its write.
- No application-level locking (mutex, advisory lock) — the guard is a single `WHERE` clause,
  cheap and stateless.

**Negative / trade-offs:**
- Every call site that transitions a Decision must handle the "someone else already moved it"
  case explicitly, or it degrades to a generic 500 / unhandled rejection. Two call sites do
  this today (the transition route, `queue-actions.ts`); a future third call site must repeat
  the pattern.
- The guard only protects `transitionDecision` itself — `proposeDecision`'s insert has no
  equivalent concern (no existing row to race on).

**Neutral:**
- This is the same compare-and-swap shape used for nothing else in the codebase today; if a
  second table develops the same concurrent-actor problem, this ADR is the precedent to reuse
  rather than re-deriving a locking strategy from scratch.
