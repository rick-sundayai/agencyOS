# Candidate cards: honest fit language + job-order filter

## Context

This is the first of three sub-projects in a broader UI/UX pass, scoped for recruiter/salesperson
users of the Control Room. The other two (Cockpit/risk-alert triage, Pipeline board) are deferred
to their own specs.

Auditing the live app surfaced two concrete problems in how candidate cards present fit
information and let a recruiter navigate them:

1. A job order's sourcing shortlist ([SourcingPanel.tsx](../../../src/app/jobs/[id]/SourcingPanel.tsx))
   always renders a raw `distance 0.235`-style chip — a cosine-distance embedding internal — even
   after a real `fit_rating` (Strong/Borderline/Poor fit) exists for that candidate. It's the only
   signal before screening runs, and stays visible alongside the real fit-badge afterward: two
   overlapping signals, one of them meaningless to a non-technical user.
2. The Candidates grid ([candidates/page.tsx](../../../src/app/candidates/page.tsx)) shows every
   candidate across every job order in one flat, unordered list, with no way to narrow to a single
   pipeline.

## Non-goals

- No changes to the candidate detail page — it already renders fit-badge/fit-ring correctly; it
  inherits the shared `FIT` module from this work but needs no page-level changes.
- No changes to the Pipeline board's card rendering (own sub-project: drag-to-advance, per-job
  filtering there too).
- No quick actions (copy email, open resume, etc.) added to any candidate card in this pass.
- No fix to garbled `current_title` seed/import data (e.g. a company name where a job title
  belongs) — that's upstream data quality, not a rendering problem, and papering over it in the UI
  would mask the real defect.
- No new fit-tier granularity beyond what the domain already defines — `matchTier` uses the single
  0.55 cosine-distance threshold already documented in [CONTEXT.md](../../../CONTEXT.md) as "good
  match," not an invented scale.

## Part 1 — Shortlist match language

**Shared module.** The `FIT` label/tone lookup (`{ yes: 'Strong fit', borderline: 'Borderline', no:
'Poor fit' }` plus tone classes) is currently duplicated verbatim in three files:
[candidates/page.tsx](../../../src/app/candidates/page.tsx),
[candidates/[id]/page.tsx](../../../src/app/candidates/[id]/page.tsx), and
[SourcingPanel.tsx](../../../src/app/jobs/[id]/SourcingPanel.tsx). Consolidate it into one shared
module, `src/components/fit.ts`, mirroring the existing `tierMeta()` pattern in
[tiers.ts](../../../src/components/tiers.ts) — a single source of truth all three files import
from instead of re-declaring.

Add `matchTier(distance: number): { label: string; tone: string }` to the same module:

- `distance < 0.55` → `{ label: 'Close match', tone: 'match-close' }`
- `distance >= 0.55` → `{ label: 'Possible match', tone: 'match-possible' }`

New CSS classes `.match-chip` / `.match-close` / `.match-possible` render as a quiet, neutral chip
(reusing the existing `.chip` visual weight, not the loud `.fit-badge` green/red treatment) — this
is a pre-screening similarity signal, not a graded judgment, and shouldn't visually compete with a
real fit-badge once one exists.

**Display logic** in `SourcingPanel.tsx`'s shortlist card: if `s.fit_rating` is set, render only the
`fit-badge` (existing behavior, unchanged). If not, render only the `matchTier` chip. Never both;
never the raw `distance` number. The `distance` field itself stays in the `ShortlistEntry` type and
API response (still useful for debugging/logs) — only the raw-number chip in the UI goes away.

## Part 2 — Job-order filter on the Candidates grid

**Service layer.** `listCandidates(orgId: string, opts?: { jobOrderId?: string })` in
[ats-views.ts](../../../src/services/ats-views.ts): when `jobOrderId` is provided, inner-join
through `applications` (`applications.candidate_id = candidates.id and applications.job_order_id =
:jobOrderId`) so only candidates with a pipeline against that job order are returned. No filter
(the default, `opts` omitted) preserves exactly today's unfiltered behavior — existing callers
(e.g. any test coverage) are unaffected.

**Page.** `candidates/page.tsx` reads the filter from the `job` search param
(`?job=<job_order_id>`), passes it through to `listCandidates`, and renders a `<select>` populated
from `listJobOrders(orgId)` (already exported, used today by the Job Orders page) with a leading
"All job orders" option representing no filter. The page stays a server component — filtering
happens via the URL, not client state.

**Filter control.** The `<select>` needs to auto-submit on change to update the URL — a small
client-side island (`JobOrderFilter.tsx`, `'use client'`) that calls `router.push` with the updated
`?job=` param on `onChange`. Scoped the same as existing client islands in this codebase
(`SourcingPanel`, `QueueLive`) — no new architectural pattern.

## Testing

- Unit test `matchTier()` for both sides of the 0.55 threshold and the boundary itself.
- Unit test `listCandidates` with and without `jobOrderId`: filtered call returns only candidates
  with a matching `applications` row; unfiltered call is unchanged (regression guard against the
  join changing default behavior).
- Component/integration test for the shortlist card: fit_rating present → fit-badge only, no match
  chip, no raw distance text; fit_rating absent → match chip only, correct label on both sides of
  the threshold.
