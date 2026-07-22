# GCP staging POC: execution + teardown

**Date:** 2026-07-22
**Status:** Approved design (brainstorm output)
**Owner:** Rick Love

## Goal

The per-client stamp architecture (`docs/superpowers/specs/2026-07-18-deployment-stamps-design.md`)
was designed, coded, reviewed, and merged to `main` on 2026-07-18 — but never applied against real
GCP. This spec covers taking the `staging` stamp from Terraform-authored-but-never-run to a live,
verified deployment, and doing so **repeatably**: this will be executed more than once before
production, so a clean, thorough teardown between cycles is part of the design, not an afterthought.

This is not a redesign. The architecture, region defaults (`us-central1`), and stamp module are
unchanged from the 2026-07-18 spec. A separately-pasted generic GCP guide (europe-west1, GDPR
framing, `agencyos-recruiting-prod` naming) was evaluated and explicitly not adopted here — it
described a hypothetical future EU client stamp, not this execution pass.

## Scope

**In scope:**
- Executing the pending OPERATOR steps from `docs/handoffs/2026-07-18-stamp-execution.md` for the
  `ops` project and the `staging` stamp.
- Verifying the deployment actually works (not just "CI is green").
- A repeatable, thorough teardown procedure for the `staging` stamp between test cycles.
- Fixing the `:bootstrap` image documentation gap in `docs/deployment.md`.
- A small, scoped Terraform change (`sql_deletion_protection` variable) needed to make staging
  teardown possible without hand-editing state or module source each cycle.

**Out of scope:**
- Any new client stamp (EU or otherwise).
- Architecture changes to the stamp module beyond the one deletion-protection variable.
- The stamp-architecture ADR (deferred; write once staging has been proven live and stable).
- The custom-domain monitoring gap in `infra/modules/stamp/main.tf` (staging has no custom domain,
  so it doesn't apply here).

## Execution sequence

Ordering follows the chicken-and-egg constraint identified in the 2026-07-18 handoff (Task 9 §3):
the `ops` Artifact Registry must exist before any image can be pushed to it, but Cloud Run needs an
image to deploy.

1. **Operator (Rick):** `gcloud auth login` — interactive browser OAuth, cannot be scripted.
2. **Operator (Rick):** `gcloud billing accounts list` — confirm the billing account locally; the ID
   is not pasted into chat.
3. **Agent, with plan review:** `cd infra/ops && terraform init && terraform apply` — creates the
   ops project, Artifact Registry, Terraform-state GCS bucket, GitHub Workload Identity Federation
   pool/provider, and the `github-deployer` service account.
4. **Agent:** `terraform init -migrate-state` in `infra/ops` — moves state from local to the new GCS
   backend (bucket name: `<ops_project_id>-tfstate`).
5. **Agent:** set the 4 GitHub repo variables from the `ops` Terraform outputs via `gh`:
   `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_AR`, `GCP_REGION`.
6. **Agent:** build and push the `:bootstrap` image(s) (`docker build --target runtime/migrate ...`
   and the app image) to the new Artifact Registry — breaks the chicken-and-egg so `infra/stamps/staging`
   has an image to reference on its first apply.
7. **Agent, with plan review:** `cd infra/stamps/staging && terraform apply` — creates the actual
   Cloud Run (`app` + `n8n`), Cloud SQL (private IP, `pgvector`), VPC, Secret Manager secrets,
   service accounts, and monitoring for staging. This is the step that starts real billing (~$30-60/mo
   while it exists).
8. **Agent:** trigger the first real deploy — `gh workflow run deploy-staging`.
9. **Agent:** verify the deploy, independent of CI's own smoke test:
   - Login page renders at the stamp's `*.run.app` URL.
   - Cockpit SSE stream (`/api/cockpit/stream`) connects.
   - An agent-key-authenticated ping against `/api/agent/*` succeeds.
   - Screenshot or curl output shown as evidence — not just "the workflow passed."
10. **Agent:** update `docs/deployment.md`'s "Onboard a client" section to document the `:bootstrap`
    image step, so a first-time operator following only the runbook doesn't hit "image not found."

## Teardown, per test cycle (staging only)

`ops` is persistent fleet infrastructure by design (real future clients onboard against it without
recreating it) and is **not** torn down between test cycles — only `staging` is.

Two resources actively resist deletion, on purpose:
- `google_sql_database_instance.pg` has `deletion_protection = true` hardcoded in
  `infra/modules/stamp/main.tf`.
- `google_project.stamp` has `deletion_policy = "PREVENT"` — Terraform itself can never delete a
  project; this is a deliberate safety net for real client stamps.

**Module change required:** add a `sql_deletion_protection` variable to the `stamp` module
(default `true`, threaded to `google_sql_database_instance.pg.deletion_protection`). Real client
stamps keep the default (`true`). `infra/stamps/staging` sets it to `false`, since staging is
explicitly disposable test infrastructure holding only fixture/smoke-test data.

**Procedure (repeated each cycle):**
1. `terraform -chdir=infra/stamps/staging destroy` — removes Cloud Run (app + n8n), Cloud SQL, VPC,
   Secret Manager secrets, service accounts, monitoring. Leaves an empty project shell (blocked by
   `PREVENT`, deliberately — this is not a bug to work around with a variable).
2. `gcloud projects delete agencyos-staging --quiet` — the actual, provable deletion event that
   stops all billing for the stamp. Same pattern already documented for offboarding a real client
   in `docs/deployment.md`.
3. Verify: `gcloud projects list` confirms `agencyos-staging` shows `DELETE_REQUESTED` (or is gone),
   and no Cloud SQL/Cloud Run resources remain billing anywhere in the project.
4. Next cycle: re-run `terraform apply` in `infra/stamps/staging` from scratch. `ops` is untouched,
   so this skips straight to stamp creation — no WIF/registry/GitHub-variable rework needed.

No pre-teardown data export is needed for staging (unlike the real-client offboarding runbook) —
staging holds only fixture/smoke-test data, reseeded fresh each cycle.

## Pre-production requirement: full fleet nuke (one-time, not per-cycle)

Before this architecture is ever used to onboard a real paying client, run a **full fleet nuke**
once: tear down `staging` as above, **and** destroy `ops` itself —
`terraform -chdir=infra/ops destroy` followed by `gcloud projects delete agencyos-ops --quiet`.

This is a **gate between testing and production**, not a step in the repeatable test cycle. It
proves the entire fleet — including the `ops` bootstrap, WIF trust relationship, and GitHub
repo-variable wiring — can be stood up completely from zero, with nothing left over from the test
phase (stale IAM bindings, stale WIF grants, stale registry images) carrying into the first real
client's infrastructure. Skipping this and reusing a test-era `ops` project for production is
explicitly disallowed by this design.

After the full fleet nuke, standing up the first real client stamp requires redoing steps 1-6 of
the execution sequence above (ops bootstrap) before any client stamp can be created.

## Safety checkpoints

Any `terraform apply` that creates real billed GCP resources (`ops`, `staging`), and any
`destroy`/`gcloud projects delete` that removes them, is preceded by showing the plan/command output
for review — not run silently in sequence.

## Definition of done

For a single test cycle: the `staging` stamp is live at its `*.run.app` URL, `deploy-staging` is
green in GitHub Actions, and there is concrete evidence (screenshot or command output) that login,
the cockpit SSE stream, and an agent-key ping all work against the real deployed instance — followed
by a clean teardown per the procedure above, verified via `gcloud projects list`.

## Out of scope (deliberately, carried from the 2026-07-18 spec)

- Multi-tenant schema work, Kubernetes/GKE, centralized cross-stamp log aggregation, EU data
  residency as a default (region remains a per-stamp Terraform variable).
