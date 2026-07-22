#!/usr/bin/env bash
# Close AgencyOS issues #1-9 (Control Room UI redesign epic) — shipped but never closed.
# Run from inside the AgencyOS repo checkout with `gh` authenticated.
set -euo pipefail

gh issue close 1 --comment "Shipped in deccd6a (design token + font layer & theme toggle)."
gh issue close 2 --comment "Shipped in aa88784 (Control Room shell — sidebar nav, active section, live pending-Decision badge)."
gh issue close 3 --comment "Shipped in 4277853 (live Agent roster in the sidebar from a pure runs→roster selector)."
gh issue close 4 --comment "Shipped in 7755501 (calm Health rail of operational vital signs above the Cockpit)."
gh issue close 5 --comment "Shipped in f242564 (reskin Decision card to the .dcard family with tier badges & risk treatment)."
gh issue close 6 --comment "Shipped in d3f9cd0 (queue-local Decision review Drawer with evidence provenance)."
gh issue close 7 --comment "Shipped in 5351975 (reskin the record list pages into the design system)."
gh issue close 8 --comment "Shipped in 4369cf5 (reskin record detail pages + surface candidate Consent)."
gh issue close 9 --comment "Shipped in 31df709 (reskin the login screen into the design system)."
