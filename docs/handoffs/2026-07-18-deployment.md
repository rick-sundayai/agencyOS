# Handoff: AgencyOS — 2026-07-18 (deployment brainstorm → plan)

## Context

AgencyOS is an agentic recruiting Cockpit (Next.js 16.2.10, React 19, Drizzle over Postgres, next-auth v5 beta, SSE cockpit stream; see `CONTEXT.md`). This session took the deployment topic from zero to an approved design spec and a complete implementation plan, via `superpowers:brainstorming` → `superpowers:writing-plans`. The owner (Rick, rick@sundayaiwork.com) is building an AI-enablement consulting business for SMBs (recruiting, accounting, medical offices); requirements were: repeatable, scalable, solo-operable now / small-team later, and privacy/infosec-regulation compatible.

## Current state

- **Design spec: approved and committed** (`dba83d6`). All five brainstorm forks resolved with the user (see Key decisions).
- **Implementation plan: written, self-reviewed, committed** (`9a14798`). 11 tasks, dependency-ordered, TDD steps with complete code.
- **No implementation has started.** The session ended at the writing-plans execution-choice gate: the user was asked "Subagent-Driven or Inline execution?" and has NOT yet answered. That is the exact resumption point.
- Two follow-up tasks from the previous session may still be in flight in other sessions (`task_c601eda9` flaky backfill-embeddings test; `task_ad08b549` button-reset tokenization) — check before rebasing.
- Pre-existing: 4 `tsc` errors in untouched `scripts/migration` files; CI in the plan deliberately gates on lint+test+build, not tsc, until fixed.

## Key decisions

1. **Tenancy: one instance per client ("stamp")** — matches the code (no tenant model), hard isolation, offboard = delete project.
2. **Compliance: strong baseline now, HIPAA-eligible later** — every chosen service must be Google-BAA-coverable so a medical client never forces a re-platform.
3. **Platform: GCP Cloud Run + Cloud SQL (private IP, pgvector)** — SSE-compatible, scale-to-near-zero, and Vertex AI keeps Gemini calls BAA-eligible in-project.
4. **Agent runtime: self-hosted n8n per stamp** (n8n Cloud excluded — outside compliance boundary). n8n cron replaces Cloud Scheduler; min-instances=1.
5. **Isolation: one GCP project per client** under a folder; shared ops project for Artifact Registry / TF state / WIF.
6. **Spec deviation decided during planning:** n8n editor is IAM-gated via `gcloud run services proxy` instead of IAP (no per-stamp load balancer). Documented in the plan header; user has not objected but was told they can revert to IAP.

## Artifacts

- Spec: `docs/superpowers/specs/2026-07-18-deployment-stamps-design.md`
- Plan: `docs/superpowers/plans/2026-07-18-gcp-stamp-deployment.md` (11 tasks; Tasks 7 & 8 contain OPERATOR-only `terraform apply` steps needing Rick's GCP org/billing creds)
- Prior session's handoff (UI redesign context): `AgencyOS-handoff-2026-07-18.md`
- Domain docs: `CONTEXT.md`, `docs/adr/0001…0002`, `AGENTS.md` (note: bleeding-edge Next — read `node_modules/next/dist/docs/` before Next-specific changes)
- Recent commits: `git log --oneline -5` (`9a14798` plan, `dba83d6` spec, then UI-redesign commits)

## Next steps

1. Ask the user which execution mode: **Subagent-Driven (recommended)** or **Inline** — then invoke the matching skill and execute the plan task-by-task.
2. Tasks 1–5 (code: migrate entrypoint, pool env, Vertex embed module, Docker, smoke script) are independent and agent-executable immediately.
3. Task 6 (CI) needs a PR + `gh run watch`. Tasks 9–10 (deploy/promote workflows) can be authored anytime but only go green after step 4.
4. Prompt Rick to run the OPERATOR steps: `infra/ops` apply → set 4 GitHub repo variables → push bootstrap images → `infra/stamps/staging` apply (order detailed in Task 9 Step 3 of the plan).
5. Task 11 runbook last; then consider recording the stamp architecture as an ADR (grill-with-docs suggested it).

## Suggested skills

- `superpowers:subagent-driven-development` or `superpowers:executing-plans` — the plan's required execution sub-skill, per the user's pending choice.
- `superpowers:test-driven-development` — Tasks 1–3 are written as strict red-green cycles.
- `security-first` / `security-review` — before merging Terraform/workflow tasks (secrets, WIF, public invoker surface).
- `superpowers:verification-before-completion` — several steps claim green CI/docker runs; verify with real command output.
- `grill-with-docs` — if the user wants the stamp decisions captured as ADRs.
