# AgencyOS infrastructure

Layout:
- `ops/` — shared: Artifact Registry, Terraform state bucket, CI identity (WIF). Applied once.
- `modules/stamp/` — the per-client unit: app + n8n on Cloud Run, Cloud SQL, secrets, monitoring.
- `stamps/<name>/` — one root module per stamp (staging is a stamp). `terraform apply` here creates/updates one client.
- `stamps.json` — machine-readable stamp list consumed by the promote workflow.

Bootstrap order (operator, one time):
1. `cd infra/ops && terraform init && terraform apply` (vars: org_id, billing_account, ops_project_id). First apply uses local state.
2. Uncomment the `backend "gcs"` block, then `terraform init -migrate-state`.
3. Set GitHub repo variables from the outputs:
   `gh variable set GCP_WIF_PROVIDER --body "<wif_provider>"`
   `gh variable set GCP_DEPLOY_SA --body "<deployer_sa>"`
   `gh variable set GCP_AR --body "<artifact_registry>"`
   `gh variable set GCP_REGION --body "us-central1"`
4. Create the staging stamp: see `stamps/staging/`.

Per-stamp secrets (JobDiva creds) go in `stamps/<name>/secrets.auto.tfvars` — **gitignored, never committed**.
