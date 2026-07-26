# 0009: AgencyOS is an agency operations platform, not an autonomy platform

**Date:** 2026-07-26

**Status:** Accepted

## Context

Two incompatible theses about AgencyOS's reusable core were both physically present in the
repo: that the product is a **brokerage domain model** (parties, inventory, pipelines,
commission) with recruiting as one vertical, or that the product is the **supervised-autonomy
runtime** (Decisions, Tiers, autonomy policy, compliance gate) with recruiting as one
application of it.

**Supervised-autonomy platform.** The genuinely distinctive and already-finished asset is the
governance runtime, and it generalises far beyond agencies — anywhere agents act on a human's
behalf under supervision. Rejected because it makes the second customer an unknown: it could be
an estate agency or something with nothing else in common, which gives no design constraint to
build against and no reason to keep the recruiting investment.

**Agency operations platform (chosen).** The core is brokerage; verticals sit on top; the
autonomy runtime governs every action any vertical takes. Chosen because the second customer is
a named, high-confidence bet (a real estate agency), which turns generality into a testable
design constraint rather than an open-ended one.

## Decision

AgencyOS is an agency operations platform, not an autonomy platform. The brokerage domain model
is the product; the autonomy runtime is substrate that makes it modern rather than the product
itself.

## Consequences

**Positive:**
- The bet is now falsifiable: if the brokerage core turns out to be a thin fraction of each
  vertical, AgencyOS is a shared library rather than a platform, and this decision should be
  revisited rather than defended.
- Generality becomes a testable design constraint (the real estate vertical) rather than an
  open-ended one.

**Neutral:**
- The architecture is three layers, not two: governance runtime (built) → brokerage core (does
  not yet exist as a distinct thing) → vertical module (recruiting, currently fused with the
  core).
- The work is **extraction**, not integration. The CRM and ATS clusters already share one
  schema and one app; what is missing is the seam between what is agency-shaped and what is
  recruiting-shaped.

**Negative / follow-on work:**
- `ACTION_CLASS_NAMES` must stop being a closed enum. Verticals supply their own action
  classes, which forces the Decision contract open — the most safety-critical change this
  thesis implies, and one that needs its own ADR.