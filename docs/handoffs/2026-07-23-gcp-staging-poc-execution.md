# Handoff: AgencyOS GCP staging POC — 2026-07-23

## Context
AgencyOS is standing up its first-ever real GCP staging environment (project `agencyos-staging`, plus a shared `agencyos-ops-f2f92e` ops project) to prove the Terraform stamp module end-to-end before onboarding real clients. This session executed the approved plan `docs/superpowers/plans/2026-07-22-gcp-staging-poc-execution.md` (Tasks 1–4 were done in an earlier session; this session did Task 5 live-apply and started Task 6 credential provisioning).

## Current state

**Task 5 (apply the staging stamp + first real deploy): COMPLETE.**
- `terraform apply` in `infra/stamps/staging` succeeded after a long iterative debug loop (see Key decisions below for every bug found/fixed).
- `app_url` = `https://app-uke3d6peea-uc.a.run.app`.
- Triggered and watched `gh workflow run deploy-staging` (run ID `30015758829`) to completion — migrations ran, app deployed, smoke test passed all three checks:
  ```
  ok   login page renders (200, html)
  ok   agent API is up and key-guarded (401/403 without key)
  ok   cockpit stream endpoint does not 5xx
  ```

**⚠️ UNCOMMITTED CHANGES — highest-priority next step.** All the real bugs found and fixed during Task 5's live-apply loop are sitting **uncommitted** in the working tree right now:
```
 M docs/deployment.md
 M infra/modules/stamp/main.tf
 M infra/modules/stamp/variables.tf
 M infra/stamps/staging/main.tf
?? infra/modules/stamp/.terraform.lock.hcl
```
These changes are what's actually deployed and running on GCP right now (Cloud SQL edition fix, secret-version filtering, cross-project Artifact Registry IAM grant, `deletion_protection = false` on Cloud Run resources, org-policy exception for public invoker, n8n image mirroring, amd64 build-platform fix). They must be committed before doing anything else, or this working infra state has no git record. Diff stat: `docs/deployment.md` +4/-2 lines, `infra/modules/stamp/main.tf` +84/-24 (net), `infra/modules/stamp/variables.tf` +3/-2, `infra/stamps/staging/main.tf` +1. The `.terraform.lock.hcl` file is new/untracked — check whether it should be committed (lock files usually should be) or is gitignored elsewhere.

**Task 6 (provision operator + n8n's real agent key): IN PROGRESS.**
- Code done and committed (commit `a1c42a1`): `scripts/ops/bootstrap-staging-operator.ts` + test, written TDD (red→green), both tests passing.
- **Blocked on Rick**, waiting for him to run a set of commands in his own terminal (deliberately not run by the agent, since they generate/print real plaintext secrets — an admin password and an n8n API key — that shouldn't pass through agent context on purpose). The exact command block was already sent to Rick in chat; it covers:
  1. Start `cloud-sql-proxy agencyos-staging:us-central1:agencyos` (note: `cloud-sql-proxy` was **not found** on this machine's PATH — Rick needs to install it first, e.g. `brew install cloud-sql-proxy`)
  2. Build a proxy-local `DATABASE_URL` from the real `database-url` secret
  3. Run `npx tsx scripts/ops/bootstrap-staging-operator.ts` (prints admin password — save to password manager)
  4. Run `npx tsx scripts/agents/create-agent-key.ts --name n8n --org "Sunday AI Work"` (prints n8n's real API key)
  5. `gcloud run services update n8n ... --update-env-vars AGENCYOS_AGENT_API_KEY="$N8N_KEY"`
  6. Three curl checks: agent-key-authenticated `/api/agent/decisions` (expect 200), `/login` (expect 200), `/api/cockpit/stream` (expect non-5xx)
- Waiting on Rick to paste back the three status-code lines from step 6 as Task 6's definition-of-done evidence.

**Not started:** Task 7 (tear down staging stamp — has a mandatory STOP gate, must get Rick's explicit go-ahead before any `terraform destroy`).

**Stale artifact needing an update:** `.superpowers/sdd/progress.md` still says "Task 5: not started. Task 6: not started." — it was not updated during this session's live-apply work and should be brought current (Task 5 complete with full bug list, Task 6 in-progress) before the next session relies on it.

## Key decisions

- **Real bugs found and fixed in the shared `infra/modules/stamp` module during Task 5** (all now permanent fixes affecting every future client stamp, not staging-only hacks — currently uncommitted, see above):
  - Cloud SQL `Edition` defaults to `ENTERPRISE_PLUS`, incompatible with `db-g1-small` tier → pinned `edition = "ENTERPRISE"`.
  - Secret Manager rejects empty-string payloads → added `secret_has_value` local (using `nonsensitive()` to safely use a sensitive-derived boolean in a `for_each` filter) and filtered both the JobDiva secret *versions* and n8n's env-var references to those secrets.
  - Cross-project Artifact Registry pulls need an explicit IAM grant → added `google_artifact_registry_repository_iam_member.stamp_pulls_images` granting the stamp's own Cloud Run Service Agent (`service-<PROJECT_NUMBER>@serverless-robot-prod.iam.gserviceaccount.com`) `roles/artifactregistry.reader` on the ops registry.
  - `deletion_protection` blocked replacing already-tainted Cloud Run resources → set `deletion_protection = false` on both services + the migrate job; had to `terraform untaint` manually first since the destroy-time check reads live state, not new config.
  - Org's Domain Restricted Sharing policy (`constraints/iam.allowedPolicyMemberDomains`) blocked the app's public `allUsers` invoker binding → **asked Rick explicitly via AskUserQuestion** rather than deciding unilaterally; he chose "add a project-level exception" over an org-wide change. Implemented via a new `google_org_policy_policy` resource, scoped to the stamp's own project.
  - n8n's Docker image (`docker.n8n.io/...`) isn't a registry Cloud Run can pull from → **asked Rick again**; he chose "mirror into the existing AR repo" over other options. `n8n_image` variable is now required (no hardcoded default) on both the module and `infra/stamps/staging/main.tf`.
  - Apple Silicon `docker build` defaults to arm64; Cloud Run needs amd64 → rebuilt both bootstrap images with `--platform linux/amd64`, and fixed `docs/deployment.md`'s documented build commands permanently.
- **Propagation-lag discipline**: every time an IAM/org-policy error looked like it should be fixed already, verified against live GCP state (`gcloud ... get-iam-policy`, project number checks) before concluding "just wait" — this correctly distinguished real config bugs from transient eventual-consistency delays several times.
- **Secrets don't flow through agent context on purpose**: for Task 6's live steps (which intentionally print an admin password and an API key to stdout for the operator to capture), the agent handed Rick the full command block to run himself rather than running it via Bash — same reasoning as why `terraform apply` itself is run by Rick, not the agent (an auto-mode classifier blocks large/risky applies from the agent side, but the secrets concern here is a separate, deliberate choice).
- **Known unresolved discrepancy (not fixed, flagged twice)**: `infra/ops/terraform.tfvars`'s `billing_account` points to a different (newer) billing account than the one the live `agencyos-ops-f2f92e` project is actually billed under (the original account, confirmed correct in `infra/stamps/staging/terraform.tfvars`). Out of scope for this plan; needs a decision from Rick eventually.

## Artifacts
- Plan: `docs/superpowers/plans/2026-07-22-gcp-staging-poc-execution.md` (Task 6 starts at line 320, Task 7 at line 464)
- Design spec: `docs/superpowers/specs/2026-07-22-gcp-staging-poc-execution-design.md`
- Execution ledger: `.superpowers/sdd/progress.md` (stale — see above)
- Deploy workflow run: `gh run view 30015758829 --repo rick-sundayai/agencyOS`
- Recent commits: `git log --oneline -6` → `a1c42a1` (this session's Task 6 script), `93c1fc3`, `6b72f79`, `deced09`, `ffe989a`, `4ea9247`

## Next steps
1. **Commit the uncommitted Task-5 infra fixes** in `infra/modules/stamp/main.tf`, `infra/modules/stamp/variables.tf`, `infra/stamps/staging/main.tf`, `docs/deployment.md` (and decide on `infra/modules/stamp/.terraform.lock.hcl`) before anything else touches this repo.
2. Wait for Rick to run the Task 6 command block and report back the three status-code lines (`agent decisions:`, `login:`, `cockpit stream:`). If any is unexpected, diagnose against the live Cloud Run service/env vars, not by guessing.
3. Once Task 6's evidence is in, update `.superpowers/sdd/progress.md` to mark Task 5 and Task 6 complete, with the bug list from "Key decisions" above logged the same way Tasks 1–4 were.
4. Move to Task 7 (teardown) — **do not run `terraform destroy` without an explicit fresh go-ahead from Rick in chat**, per the plan's mandatory STOP gate. Expect the destroy to fail only on `google_project.stamp` (protected by `deletion_policy = "PREVENT"`), which is the expected/correct behavior, followed by a separate manual project-deletion step.
5. Surface the `infra/ops/terraform.tfvars` billing-account mismatch to Rick for a decision, whenever convenient — it's real but not urgent.

## Suggested skills
- `superpowers:systematic-debugging` — if Task 6's verification curls return unexpected codes, use this before guessing at fixes.
- `superpowers:verification-before-completion` — before declaring Task 6 or Task 7 done, confirm with actual command output (this session's discipline throughout Task 5 — never assert success without re-checking live state).
- `superpowers:subagent-driven-development` — Task 7's teardown is a controller-run task per the plan's execution model (STOP gate needs real-time chat go-ahead), but if a fresh implementation task comes up afterward (e.g. onboarding the first real client stamp), this is the plan's designated flow for ordinary code tasks.
