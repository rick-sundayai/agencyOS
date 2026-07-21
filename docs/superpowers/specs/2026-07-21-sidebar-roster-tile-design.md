# Sidebar roster tile — actionable workforce, swappable content

**Date:** 2026-07-21
**Status:** Approved (design)

## Problem

The bottom-left sidebar tile (`AgentRoster`) renders a static roll-call: seven
persona names, each with a coloured status dot, plus an "N/M online" summary. It
occupies always-visible real estate on every page yet answers a question the
operator rarely asks — "who exists and are they green?" — and is disconnected
from the operational workflow the rest of the sidebar serves (the Cockpit's
pending-decisions badge, the Health rail on `/`). It also discards everything
`agent_runs` records, leaving only a dot.

The tile should surface what the operator can act on, and its content should be
easy to replace once the team's real usage clarifies what belongs there.

## Decisions

- **Content direction (for now): actionable agent roster.** Lead with agents
  that need attention; collapse healthy agents into a summary. Chosen over a
  "vitals mirror" of the Cockpit Health rail and an "exceptions-only alarm"
  because the team wants to keep the tile workforce-focused while it learns how
  the surface gets used. This may change — hence the swappability requirement
  below.
- **Summary carries status only.** `N running · M idle`. No throughput or cost.
  Reuses the existing `Roster` selector output; no new queries, no `agent_runs`
  aggregation, no model→price map.
- **Attention rows link, they do not act.** No retry/rerun endpoint exists in the
  codebase. Rows drill to `/agents` — the same target the Health rail's "Agents"
  signal already uses — where per-agent status and 7-day throughput already live.
- **Vocabulary matches `/agents`:** `stalled` renders as "Stalled", `review`
  renders as "Needs you".

## The swappable seam

The requirement "easily replace the content later" defines the seam, and the
current structure already satisfies it:

- `src/app/layout.tsx` renders the tile at **one site**:
  `{roster && <AgentRoster roster={roster} />}`.
- To swap the tile's content later (to a Health-rail mirror, an exceptions-only
  alarm, etc.), point that one line at a different component. The `{ roster }`
  prop is this occupant's contract; a future occupant declares whatever props it
  needs and the layout loads whatever data those need.
- No registry, config, or slot abstraction is introduced (YAGNI). The seam is the
  single render site plus a narrow, self-contained tile component.

Data flow is unchanged: `layout.tsx` already calls `listRoster(orgId)` and passes
the result. This change adds **zero** new queries.

## Components and data flow

### New pure selector: `rosterView(roster: Roster): RosterView`

Lives beside the existing `rosterFrom*` selectors in
`src/services/agent-roster.ts`, following the established "pure selector → dumb
tile" pattern.

```ts
export type RosterView = {
  attention: RosterEntry[]; // status 'stalled' or 'review', stalled first
  running: number;          // count of status 'working'
  idle: number;             // count of status 'idle'
};
```

Derivation from `roster.entries`:

- `attention` = entries whose status is `stalled` or `review`, sorted so all
  `stalled` precede all `review` (stalled is the alarm and must lead). Within a
  status, preserve the entries' existing (name-sorted) order.
- `running` = count of entries with status `working`.
- `idle` = count of entries with status `idle`.

Every entry falls into exactly one bucket: `working`→running count,
`idle`→idle count, `stalled`/`review`→attention rows.

### Rewritten tile: `AgentRoster` (`src/components/AgentRoster.tsx`)

Remains a dumb server tile taking `{ roster }`. Renders `rosterView(roster)`:

- **Empty** (`roster.total === 0`): render `null`, exactly as today.
- **Header:** label `Agents`, plus a summary reading `N running · M idle` using
  `running`/`idle` from the view.
- **Attention rows** (only when `attention` is non-empty): for each entry, the
  persona icon (via `personaFor`, same treatment as today), the humanised name,
  and a status label — "Stalled" in the `--bad` tone, "Needs you" in the review
  tone. The tile links to `/agents` (wrap the tile, or the attention list, in a
  `next/link` to `/agents`).
- **All-healthy** (`attention` empty): header + summary line only. No per-agent
  healthy rows — the seven-name wall is removed.

Presentation stays on the existing semantic-CSS token layer (Control Room house
style); reuse the existing `roster-*` class vocabulary where it still applies and
add classes as needed for the summary and attention rows. Status colour continues
to follow "colour is the alarm" — only `stalled` (and, more mutedly, `review`)
carry non-neutral tone.

## Testing

- **`rosterView` unit tests** (pure function): all-healthy (attention empty,
  running/idle counts correct); one stalled (leads attention); mixed
  stalled + review + idle (ordering: stalled before review, idle only in count);
  empty roster (empty attention, zero counts).
- The tile stays a dumb renderer, so no behavioural component tests beyond what
  the selector covers — matching how `rosterFromRuns`/`rosterFromAgents` are
  tested today.

## Out of scope

- Throughput or cost in the tile (deferred; `/agents` already shows 7-day
  throughput).
- Any retry/rerun action or endpoint.
- Per-agent detail route (none exists; `/agents` is the drill target).
- A generic sidebar-slot/registry abstraction.
