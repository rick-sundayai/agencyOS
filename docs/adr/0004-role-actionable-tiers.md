# 0004: Role-tier actionability as a Tier-indexed table, not a bespoke `isAdmin` flag

**Date:** 2026-07-13 (implemented); recorded retroactively 2026-07-22 — cited as "ADR-0004" in
`contracts/decision.ts` and `queue-actions.ts` since it was written, but the file itself was
never created. Backfilled now to close that gap; no change in substance.

**Status:** Accepted

## Context

The Cockpit needs to gate which of its two roles (`admin`, `recruiter`) may act on a given
Decision, and that gate has to key off the same axis the rest of the system already uses to
express "how much oversight a Decision needs" — its Tier (`1` / `2` / `3` / `risk`) — not a
separate, parallel concept invented just for this check.

## Decision

`ROLE_ACTIONABLE_TIERS: Record<Role, readonly Tier[]>` (`src/contracts/decision.ts`) maps each
role to the Tiers it may act on — `admin` gets all four, `recruiter` gets `1`/`2` only — and
`canActOnTier(role, tier)` is the single function every call site uses to ask the question.
`queue-actions.ts`'s `requireCanAct` calls it against the Decision's actual tier (read fresh
from the row, not a client-supplied value) before allowing an approve/cancel action through.

The alternative considered and rejected was a bespoke boolean (`isAdmin` short-circuiting
straight past any tier check). That would work for today's two roles, but doesn't compose with
`autonomy_policy` (which already speaks in Tier) and has no room to grow into a per-org,
DB-backed permissions table later without a shape change — `ROLE_ACTIONABLE_TIERS` already has
the right shape for that (swap the in-code `Record` for a table keyed the same way) if the
two-role model stops being enough.

## Consequences

**Positive:**
- One function (`canActOnTier`) is the only place "can this role act on this tier" is decided —
  no duplicated boolean logic at call sites.
- Composes with the existing Tier vocabulary (`autonomy_policy`, `isRiskTier`,
  `isAutoApprovedTier`) instead of introducing a second, parallel authorization axis.
- Can grow into a per-org DB-backed table later by changing only where the mapping is read
  from, not its shape or any call site.

**Negative / trade-offs:**
- The mapping is hard-coded per role in-code today, not per-org — every org gets the same
  `recruiter`/`admin` split. Fine for AgencyOS's current single-firm-per-stamp model; would need
  the DB-backed table mentioned above if a future org needs a custom split.

**Neutral:**
- Only two roles exist today (`ROLES = ['admin', 'recruiter']`). This ADR is about the shape of
  the tier-actionability check, not a commitment to exactly two roles forever.
