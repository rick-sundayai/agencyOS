# 0008: Sourcing phase order is documentation, not transition logic

**Date:** 2026-07-22

**Status:** Accepted

## Context

`contracts/sourcing.ts` lists the eight Sourcing phases (`queued → searching_pool →
checking_jobdiva → embedding_new → shortlisting → screening → done`, plus `failed`) as an
ordered literal array. The order reads like a linear pipeline, which invites a future
"runs can only move forward" transition guard built on each phase's index in the array.

## Decision

The array's order is **documentation of the happy path only** — no code derives transition
rules from a phase's position. A position-based guard would be wrong, because the real flow
is a DAG, not a line: `checking_jobdiva` is skipped when the internal pool is already deep
enough, `embedding_new` is skipped when there are no new candidates, and `failed` is
reachable from any phase (including the staleness timeout in `getLatestSourcingRun`). An
`indexOf`-style "can't go backwards" check would reject legal skips like
`searching_pool → shortlisting` and would have to special-case `failed` anyway.

The only progression invariant we enforce is terminality — "a terminal run cannot be
resurrected" — and that is expressed as set membership via `isTerminalPhase()`, which is
order-independent. If a genuine phase-progression rule is ever required, it is modelled at
that point as an explicit allowed-transitions map (which can express the skips and the
any-state-to-`failed` edge), never as index arithmetic on the phase array.

This mirrors the Decision subsystem, whose lifecycle is likewise governed by an explicit
transition table (`contracts/transitions.ts`) plus compare-and-swap (ADR-0003), not by the
declaration order of `DECISION_STATES`.

## Consequences

**Positive:**
- The phase list stays readable in flow order without that ordering becoming load-bearing.
- The future terminal-run guard is a small follow-on over `isTerminalPhase()`, not a new
  ordered structure.

**Neutral:**
- This ADR records a deliberate *non*-decision (we did not build ordering-based transition
  logic) so a future reviewer does not re-propose it after seeing the ordered array.
