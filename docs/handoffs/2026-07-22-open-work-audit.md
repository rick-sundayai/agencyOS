# Handoff: AgencyOS — open-work audit — 2026-07-22

> **Update (2026-07-22, later same day): superseded by follow-up work this session.** The
> architecture review (item 1 below) is now fully resolved — all three still-relevant candidates
> were refactored and shipped (commits `0b450d4`, `4a98256`, `25f8c63`; the fourth candidate,
> agent-API shared-key identity, turned out to already be fixed by ADR-0005/0006/0007). The
> `ADR-0003`/`ADR-0004` gap mentioned in item 1 is also closed — both were backfilled as real ADR
> files (`docs/adr/0003-*.md`, `docs/adr/0004-*.md`), documenting decisions that were actually made
> back on 2026-07-13 and cited by name in code ever since, just never written up. That gap was
> unrelated to the architecture review itself — don't read the two as connected. Items 2–6 and the
> GitHub-issues item are still accurate as of this update. See `docs/adr/0003-*.md` and
> `docs/adr/0004-*.md` for the backfilled decisions.

## Context

No new feature work in the original session. Rick asked for the project docs to be reconciled
with reality and for a sweep of anything still open — across this repo, its GitHub issues, and
the `Agentic_Recruiting` knowledge hub. This doc records what was found so it doesn't need
re-deriving.

## What's actually done (docs said otherwise)

- **UI-triggered sourcing with JobDiva fallback** (`agencyos-handoff-2026-07-20.md`): fully shipped,
  13/13 plan tasks, `main` through commit `1f7f4ef`. The handoff doc had "implementation NOT started"
  as its last recorded state — that was true when written, stale within a day. Doc now flagged inline.
- **Architecture review from `docs/handoffs/2026-07-18-arch-review.md`**: fully resolved this
  session (2026-07-22). See that doc's own update note for the final disposition of all four
  candidates.

## Still open — action needed from Rick

- **GitHub issues #1–#9** ("Control Room UI redesign" epic, opened 2026-07-17): as of this
  update, still **open** on GitHub, but every one of them shipped — each has a matching merged
  commit that cites the issue number directly: `deccd6a` (#1 tokens/theme), `aa88784` (#2 shell),
  `4277853` (#3 roster), `7755501` (#4 health rail), `f242564` (#5 decision card), `d3f9cd0`
  (#6 drawer), `5351975` (#7 list pages), `4369cf5` (#8 detail pages), `31df709` (#9 login).
  `close-issues.sh` in the repo root has the `gh` commands to close all nine — hasn't been run
  yet as of this update. (Contrast: issues #10–#17, the CI + "port RecruiterPro's remaining
  screens" epics, were closed correctly as each landed.)

## Genuinely open / deliberately deferred — no action needed unless prioritized

1. **Pipeline board is read-only by design, drag-to-advance deferred.** Issue #13/#15's spec explicitly
   defers Stage-mutation via drag, and flags that whenever it's built it will be AgencyOS's first
   operator mutation that bypasses the Decision/Tier model — "will warrant its own ADR at that time."
   Not started, not scheduled.
2. **Analytics' three deferred metrics.** Funnel conversion %, time-to-shortlist/per-stage timing, and
   placements-vs-goal are deliberately absent (not faked) — blocked on a stage-transition event log
   (today `applications` stores only current stage + `updated_at`) and per-org placement goals. No
   log/goals work has started.
3. **JobDiva client dedupe gap.** `clients` are matched only by `(org_id, name)` string equality
   despite a `jobdiva_id` unique index existing — deliberately deferred, unverifiable until someone
   captures a live JobDiva job BI row to see if it even exposes a stable client id.
4. **GCP stamp architecture never got its ADR.** `docs/handoffs/2026-07-18-stamp-execution.md` step 5
   suggested recording the per-client stamp deployment shape as an ADR once the first `deploy-staging`
   run went green — flagged "not yet done" and nothing since indicates it happened.
5. **Operator-side Terraform applies unconfirmed.** The deployment plan's OPERATOR steps (real GCP
   `terraform apply` for client stamps, as opposed to the CI-driven staging stamp) were handed off as
   a manual next step; no artifact in this repo confirms they were run for any real client.

## Cross-repo: Agentic_Recruiting knowledge hub

- **`Project_State.md`** was stale (last updated 2026-07-09) relative to AgencyOS; updated
  2026-07-22 with a currency note pointing here. That note should be refreshed again to reflect
  the architecture-review resolution — see this doc's update banner above.
- **CAL-0003 (score-v2.3.0 adoption) has two unresolved threads**, both explicitly flagged
  "not yet confirmed" in the record itself, and confirmed still unresolved as of this update
  (Rick checked directly: n8n production is still on `score-v2.2.0`):
  - Whether `score-v2.3.0` (grounded C11) should be promoted to the live n8n `Resume Screening
    Prompt` node. Recommended next step (not yet taken): run the confirmation calibration
    (`npm run calibrate:redacted` + `npm run diagnose` in the RecruiterPro repo) before promoting,
    since no agreement percentage was ever published for v2.3.0 — only the shifted disagreement
    set. Out of scope for AgencyOS-focused sessions; revisit when working in RecruiterPro.
  - No published agreement percentage exists for `v2.3.0` anywhere in the hub — only the shifted
    disagreement set (`P0009/P0011/P0015`). CAL-0002's 81.3% remains the last *published* number.

## Next steps

1. Run `close-issues.sh` (or the equivalent `gh issue close` commands) for GitHub issues #1–#9.
2. No action needed on the deliberately-deferred items above unless Rick wants to prioritize one.
3. CAL-0003's promotion question is RecruiterPro-scoped, not AgencyOS — revisit in that repo's
   own context rather than folding it into AgencyOS work.
