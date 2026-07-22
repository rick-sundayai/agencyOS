# Handoff: AgencyOS — open-work audit — 2026-07-22

## Context

No new feature work this session. Rick asked for the project docs to be reconciled with reality and
for a sweep of anything still open — across this repo, its GitHub issues, and the
`Agentic_Recruiting` knowledge hub. This doc records what was found so it doesn't need re-deriving.

## What's actually done (docs said otherwise)

- **UI-triggered sourcing with JobDiva fallback** (`agencyos-handoff-2026-07-20.md`): fully shipped,
  13/13 plan tasks, `main` through commit `1f7f4ef`. The handoff doc had "implementation NOT started"
  as its last recorded state — that was true when written, stale within a day. Doc now flagged inline.
- **GitHub issues #1–#9** ("Control Room UI redesign" epic, opened 2026-07-17): all nine are still
  **open** on GitHub, but every one of them shipped — each has a matching merged commit that cites the
  issue number directly: `deccd6a` (#1 tokens/theme), `aa88784` (#2 shell), `4277853` (#3 roster),
  `7755501` (#4 health rail), `f242564` (#5 decision card), `d3f9cd0` (#6 drawer), `5351975` (#7 list
  pages), `4369cf5` (#8 detail pages), `31df709` (#9 login). **These need to be closed on GitHub** —
  not done here since it's a `gh` CLI action outside this repo checkout's write scope this session.
  (Contrast: issues #13–#17, the later "port RecruiterPro's remaining screens" epic, were closed
  correctly as each landed — #10–#12 CI issues too.)

## Genuinely open / unresolved

1. **Architecture review candidate never picked.** `docs/handoffs/2026-07-18-arch-review.md`: ran
   `/improve-codebase-architecture`, presented 4 candidates (decision-store error strings,
   agent-API shared-key identity, SSE stream's untestable inline module, scattered Tier vocabulary),
   and the review paused for Rick to choose one. No later handoff or commit resumes it — no
   `ADR-0003`/`ADR-0004` exist (the ADR sequence jumps `0002 → 0005`), consistent with the review
   never having produced a decision. Still sitting at the resumption point described in that doc.
2. **Pipeline board is read-only by design, drag-to-advance deferred.** Issue #13/#15's spec explicitly
   defers Stage-mutation via drag, and flags that whenever it's built it will be AgencyOS's first
   operator mutation that bypasses the Decision/Tier model — "will warrant its own ADR at that time."
   Not started, not scheduled.
3. **Analytics' three deferred metrics.** Funnel conversion %, time-to-shortlist/per-stage timing, and
   placements-vs-goal are deliberately absent (not faked) — blocked on a stage-transition event log
   (today `applications` stores only current stage + `updated_at`) and per-org placement goals. No
   log/goals work has started.
4. **JobDiva client dedupe gap.** `clients` are matched only by `(org_id, name)` string equality
   despite a `jobdiva_id` unique index existing — deliberately deferred, unverifiable until someone
   captures a live JobDiva job BI row to see if it even exposes a stable client id.
5. **GCP stamp architecture never got its ADR.** `docs/handoffs/2026-07-18-stamp-execution.md` step 5
   suggested recording the per-client stamp deployment shape as an ADR once the first `deploy-staging`
   run went green — flagged "not yet done" and nothing since indicates it happened.
6. **Operator-side Terraform applies unconfirmed.** The deployment plan's OPERATOR steps (real GCP
   `terraform apply` for client stamps, as opposed to the CI-driven staging stamp) were handed off as
   a manual next step; no artifact in this repo confirms they were run for any real client.

## Cross-repo: Agentic_Recruiting knowledge hub

- **`Project_State.md` is stale** (last updated 2026-07-09) relative to AgencyOS, which has since
  closed out all four Phase-1 plans' worth of work and then some (UI redesign epic, sourcing feature,
  deployment, org-scoping hardening, analytics/pipeline/agents screens). Updated today — see below.
- **CAL-0003 (score-v2.3.0 adoption) has two unresolved threads**, both explicitly flagged
  "not yet confirmed" in the record itself:
  - Whether `score-v2.3.0` (grounded C11) was ever promoted from the calibration harness into the
    live n8n `Resume Screening Prompt` node, or whether production is still running `v2.2.0`. As of
    the matching-workflow design doc (2026-06-28, nine days after v2.3.0 landed in the harness), n8n
    was still on v2.2.0.
  - No published agreement percentage exists for `v2.3.0` anywhere in the hub — only the shifted
    disagreement set (`P0009/P0011/P0015`). CAL-0002's 81.3% remains the last *published* number.

## Next steps

1. Close GitHub issues #1–#9 on `rick-sundayai/agencyOS` (they're done; just not marked).
2. Ask Rick which of the 4 architecture-review candidates (if any) he wants to pursue, or explicitly
   shelve the review.
3. Confirm live n8n prompt version for scoring (v2.2.0 vs v2.3.0) directly against the
   `Agentic_Recruiter_Workflow` n8n instance and record it as a CAL-0003 follow-up.
4. No action needed on items 2–6 above unless Rick wants to prioritize one — they're deliberately
   deferred, not blocked or broken.
