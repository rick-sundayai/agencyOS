# Spec: Control Room UI redesign — port RecruiterPro's design system into AgencyOS

**Status:** ready-for-agent
**Date:** 2026-07-17
**Domain context:** [CONTEXT.md](../../../CONTEXT.md) — Cockpit
**Governing ADRs:** [0001 — semantic CSS design system](../../adr/0001-semantic-css-design-system.md), [0002 — dual light/dark token layer](../../adr/0002-dual-light-dark-token-layer.md)

> Publish target: GitHub issue (rick-sundayai/agencyOS) with the `ready-for-agent` label, once `gh` is installed. This file is the source of truth until then.

## Problem Statement

AgencyOS's interface is a bare scaffold. The Cockpit, the ATS/CRM views, the nav, and the login all render on the default Next.js template CSS — Arial, flat `#ddd` borders, inline `<details>` for a Decision's reasoning, and a plain top-nav. There is no visual hierarchy that reflects what the product actually is: an operator supervising a team of autonomous recruiting Agents. An operator can't tell at a glance which Decisions are risky, which Agents are stalled, or whether the operation is healthy. The styling is ad hoc semantic CSS with no design tokens, no theming, and no visual system to build on.

Meanwhile, a fully-realised "operations room" design system already exists in the RecruiterPro project (`design/dashboard/_unzipped/`). Its components are not generic dashboard chrome — they are literally Cockpit components (decision cards, queue groups, evidence rows, reason chips, tier badges, a health rail, an agent roster, a drawer) that map 1:1 onto AgencyOS's domain. The problem is that this design lives in another repo as a prototype and none of it is wired into AgencyOS's real, data-backed app.

## Solution

Port RecruiterPro's design system into AgencyOS wholesale as the product's real UI, adapted to AgencyOS's richer domain and data. The operator gets a **Control Room**: a persistent sidebar (nav + live Agent roster), a calm **Health rail** where color is the only alarm, and a **Cockpit** queue of Decisions rendered as rich cards with Tier badges, live Undo-window countdowns, and a slide-in **Drawer** for reviewing a single Decision's evidence without leaving the queue. Records (candidate, job order, client) remain full pages, restyled in the same visual language. The whole thing ships in both light and dark themes on a variable token layer, defaulting to light.

The port uses semantic CSS classes and CSS custom properties (per ADR 0001) — the same styling paradigm AgencyOS already uses — so components translate with near-zero rework and the theme layer has a single token surface to pivot on.

## User Stories

### Control Room shell & navigation

1. As an operator, I want a persistent left sidebar with the product identity and primary nav, so that I always know where I am and can move between surfaces in one click.
2. As an operator, I want the sidebar nav to cover my real domain — the Cockpit queue, Job Orders, Candidates, Clients, Agents, and Pipeline — so that navigation matches the work I actually do (including the CRM, which the source design omitted).
3. As an operator, I want the current section visibly marked active in the nav, so that I never lose my place.
4. As an operator, I want a count badge on the Cockpit nav item showing how many Decisions await me, so that I know there's work without opening it.
5. As an operator, I want my own account affordance (avatar, sign out) anchored in the sidebar, so that session controls are always reachable.

### Agent roster

6. As an operator, I want a live Agent roster in the sidebar showing each Agent and its status (working / review / idle / stalled), so that I can supervise the team at a glance.
7. As an operator, I want a stalled Agent to stand out immediately (color + treatment), so that the one thing needing attention is the one thing I notice.
8. As an operator, I want an at-a-glance "N/M online" summary on the roster, so that I gauge overall team availability without counting.
9. As an operator, I want roster status derived from real Agent runs, so that what I see reflects what the Agents are actually doing.

### Health rail

10. As an operator, I want a row of Health-rail tiles above the queue showing operational vital signs, so that I can read the health of the operation before triaging.
11. As an operator, I want healthy signals to render monochrome and only unhealthy ones to show color, so that color always means "look here" and a calm rail means all is well.
12. As an operator, I want each tile to show a value, unit, and short detail, so that I understand the signal without drilling in.
13. As an operator, I want to tap a Health tile to drill into the underlying view, so that I can act on a signal directly.
14. As an operator, I want a condensed status line (for the pure-queue layout) that is near-empty when healthy and shows only alerts/warnings, so that a healthy operation adds no noise.

### Cockpit & Decision cards

15. As an operator, I want each Decision rendered as a rich card showing its action class, the proposing Agent, when it was proposed, and a reasoning summary, so that I can judge it quickly.
16. As an operator, I want a Tier badge on every Decision (Auto / Undo window / Needs approval / Risk), so that I immediately know how it will be dispositioned.
17. As an operator, I want Risk-tier Decisions visually distinguished (accent edge / tinted card), so that risky items never blend in with routine ones.
18. As an operator, I want to Approve a Tier-3 Decision from the card, so that I can advance routine approvals in-flow.
19. As an operator, I want a live countdown on a Decision in its Undo window with a one-click Undo, so that I can cancel an auto-executing action before it runs.
20. As an operator, I want a Risk-tier Decision to offer "Resolve" rather than "Approve", so that the interface enforces that risky actions can't be casually approved.
21. As an operator, I want to Reject a proposed Decision, so that I can decline actions I don't want taken.
22. As an operator, I want friendly error messages surfaced on the card when a disposition fails (e.g. a stale transition), so that a race or permission issue doesn't crash the queue.
23. As an operator, I want Decisions grouped/ordered so the queue reads as a prioritised worklist, so that I work the most important items first.
24. As an operator, I want an empty state when the queue is clear, so that "nothing to do" is unambiguous.

### Decision Drawer

25. As an operator, I want clicking a Decision to open a slide-in Drawer with its full reasoning, evidence rows, and payload, so that I can review depth without leaving the queue.
26. As an operator, I want inferred vs. sourced evidence visually distinguished in the Drawer, so that I can weigh how well-founded a Decision is.
27. As an operator, I want source links / provenance on evidence, so that I can trace a claim back to where it came from.
28. As an operator, I want to disposition the Decision (Approve / Undo / Resolve / Reject) from within the Drawer, so that reviewing and acting are one motion.
29. As an operator, I want to close the Drawer and return to the queue in its prior state, so that reviewing one Decision doesn't lose my place.

### Records (full pages)

30. As an operator, I want the Candidates, Job Orders, and Clients list pages restyled in the new system (tables, chips, badges), so that records feel part of the same product.
31. As an operator, I want the candidate detail page (info, pipeline membership, scores, documents) restyled as a full page, so that I can study a record in depth.
32. As an operator, I want the job order detail page — including its pipeline board by stage — restyled, so that I can read a req's pipeline at a glance.
33. As an operator, I want Consent status surfaced where relevant to a candidate, so that compliance is visible where outreach decisions are made.

### Theming

34. As an operator, I want a light theme by default that faithfully reproduces the "operations room" design, so that the app looks as intended out of the box.
35. As an operator, I want to toggle to a dark theme, so that I can work comfortably in low light.
36. As an operator, I want my theme choice remembered across sessions, so that I don't re-set it each visit.
37. As an operator, I want "color is the alarm" to hold in dark mode too, so that a healthy operation reads calm regardless of theme.

### Auth

38. As a user, I want the login page restyled in the new visual system, so that the product feels coherent from the first screen.

### Foundational / cross-cutting

39. As a developer, I want the design tokens (color, radius, shadow, type) and component classes to live in one authoritative CSS layer, so that the whole app stays visually consistent and themeable from one place.
40. As a developer, I want the three RecruiterPro typefaces served through the app's font pipeline rather than a CDN import, so that there's no external request, no layout shift, and no privacy leak.
41. As a developer, I want the semantic-CSS + design-token approach documented as the standard, so that no one introduces Tailwind and forks the styling paradigm.

## Implementation Decisions

### Styling paradigm (per ADR 0001)

- Style with a **semantic CSS design system** — port RecruiterPro's token layer (`app.css`) and component-class layer (`rp.css`) into AgencyOS's global stylesheet(s). No Tailwind (none is present today, and none is added).
- All color/radius/shadow/type flows through CSS custom properties so the theme layer switches one surface.

### Theming (per ADR 0002)

- Ship **light + dark** as two token sets over a single CSS-variable layer, switched by a root attribute (e.g. `data-theme`), default light, choice persisted client-side.
- The dark token set is **authored net-new**, including a re-derived semantic soft-tint palette (`--*-soft`, `.dcard.risk`, `.htile.alert/.warn`), because RecruiterPro's tints are computed via `color-mix(..., var(--paper))` and do not invert for free. The "color is the alarm" principle (healthy = neutral, color = signal) must be preserved and visually re-validated in dark.
- A theme provider owns the current theme, exposes a toggle, reads/writes persistence, and stamps the root attribute.

### Typography

- Adopt RecruiterPro's three typefaces (Schibsted Grotesk display / Hanken Grotesk body / Spline Sans Mono) served via `next/font` (self-hosted), replacing the CDN `@import` in the source CSS and the current Geist fonts.

### Icons

- Provide the glyphs RecruiterPro's `<Icon>` uses as a small inline SVG icon set within AgencyOS (no runtime CDN). A dependency (e.g. an icon library) is an acceptable alternative if preferred, but is not required.

### App shell / Information Architecture

- Adopt the **Control Room** shell: fixed left sidebar (identity, nav, live Agent roster, account footer) + main content region hosting the Cockpit and record views.
- Nav taxonomy is **adapted, not copied**: Cockpit (queue), Job Orders, Candidates, Clients, Agents, Pipeline. Clients is retained because AgencyOS has a real CRM layer the source design lacked. Analytics is deferred (see Out of Scope).
- The Cockpit nav item carries a live count of pending Decisions.

### Agent roster (derived data)

- Introduce a **pure selector** that maps Agent runs to roster entries with a status of `working | review | idle | stalled`, plus the "N/M online" summary. The sidebar renders this dumb output.
- Status derivation reads existing Agent-run data; no schema change.

### Health rail (derived data)

- Introduce **pure selector(s)** that compute each Health signal's value, unit, short detail, and status (`good | warn | alert`) from existing data (e.g. queue depth, stalled Agents, Consent gaps, and other operational vitals). Tiles and the condensed status line are dumb renderers of this output.
- Signal definitions (which vitals, thresholds for warn/alert, and drill target per signal) are finalised during implementation against available data; each drills into an existing view.

### Cockpit & Decision cards

- Re-skin the existing Decision card to the `.dcard` component family: Tier badge (Auto / Undo window / Needs approval / Risk), Risk treatment (accent edge + tint), reasoning summary, live Undo-window countdown, and disposition controls.
- Disposition controls follow existing domain rules: Approve appears only for a proposed non-Risk Decision; a Decision in its Undo window shows Undo; a Risk Decision shows Resolve; otherwise Reject. Disposition failures surface as friendly inline messages, not crashes.
- The card's inline `<details>` "Why?" is replaced by the Drawer as the depth surface (see below).

### Decision Drawer

- Add a **Drawer** owned by the Cockpit/queue component. Opening it targets a single Decision and shows full reasoning, evidence rows (with inferred-vs-sourced distinction and source links), and payload; disposition actions are available inside it.
- Drawer open/close is queue-local state; closing restores the queue's prior state. Records do **not** open in the Drawer — candidate/job/client detail remain full-page routes.

### Records

- Restyle the Candidates, Job Orders, Clients list pages and the candidate/job detail pages (including the job's stage board) into the new system's tables, chips, and badges. No IA change to these routes beyond styling and surfacing Consent where relevant to a candidate.

### Data-shape boundary

- The server→client Decision shape (dates as ISO strings) is unchanged; the redesign consumes the same serialized Decision the queue already passes to the client.

## Testing Decisions

**What makes a good test here:** it asserts *external behavior* — what the operator sees and can do, and what a derived-data function outputs for a given input — never CSS values, class names, or DOM structure. The reskin itself (tokens, fonts, shell chrome, restyled cards/tables) is **verified visually in the browser preview, not unit-tested**, because asserting styling is asserting implementation.

Seams (fewest that cover behavior; existing seams preferred):

1. **Cockpit interaction — extend existing RTL seams.** Extend the existing React Testing Library component tests for the Decision card and the queue to cover the redesigned behavior: correct Tier-badge label per tier, Undo-window countdown + Undo, Approve availability rules, Resolve for Risk, Reject, friendly error surfacing, and Drawer open → evidence visible → close. Prior art: the existing `DecisionCard` and `QueueLive` component tests (jsdom + `@testing-library/react`, with the queue action module mocked).

2. **Theme toggle — one new RTL seam.** Test that toggling sets the root theme attribute and that the choice persists. Behavioral only; no assertion on rendered colors.

3. **Agent-roster status — new pure selector at the service seam.** Unit-test the run→roster selector: given Agent-run inputs, it returns the right per-Agent status (working/review/idle/stalled) and the "N/M online" summary, including the stalled edge case. Prior art: the existing Agent-runs service test.

4. **Health-rail signals — new pure selector(s) at the service seam.** Unit-test each signal computation: given data inputs, it returns the right value and status (good/warn/alert), including warn/alert threshold boundaries and the all-healthy case. Prior art: the existing service-layer tests (e.g. compliance, ats-views, decision-store).

Rendered `HealthTile` / roster components are intentionally **not** separately unit-tested — they are dumb renderers of the tested selectors, and their appearance is browser-verified.

## Out of Scope

- **Analytics view.** Requires net-new aggregation queries; deferred. The nav may omit it or stub it until the queries exist.
- **The Cockpit's "3 layout treatments."** The source design offers multiple queue layouts; this spec ships one. Additional treatments are a later iteration.
- **New domain capabilities.** This is a UI/IA redesign over existing data and behavior — no new agent workflows, no new Decision types, no changes to autonomy policy, no new record types.
- **Schema/API changes.** None; roster and Health signals are derived from existing tables. (The one exception path — Analytics — is itself out of scope.)
- **Backend/data-layer refactors** beyond adding pure read-side selectors for roster and Health signals.
- **RecruiterPro repo changes.** The source design is inspiration/asset; it is not modified.
- **Realtime redesign.** The existing decision stream/SSE mechanism is reused as-is; this spec doesn't change how updates arrive, only how they render.

## Further Notes

- **The real cost is the dark palette, not the reskin.** RecruiterPro's soft tints are all `color-mix(..., var(--paper))`; dark is a re-derivation and re-validation exercise, not an inversion. Budget accordingly (see ADR 0002).
- **Suggested build order (vertical slices):** (1) token + font layer wired for both themes; (2) Control Room shell — sidebar, roster selector + render, Health-rail selector + tiles, Drawer plumbing; (3) Cockpit — Decision card → `.dcard`, Tier badges, Undo countdown, Drawer evidence + dispositions; (4) record pages restyled; (5) login. Analytics deferred.
- **Ubiquitous language:** use the terms as defined in `CONTEXT.md` — Control Room, Cockpit, Decision, Tier, Autonomy policy, Undo window, Agent / Agent run / Agent roster, Drawer, Health rail, Consent — in code, tests, and the eventual issue.
- **Publishing:** once `gh` is installed and authed and the five triage labels exist, create the GitHub issue from this file and apply `ready-for-agent`.
