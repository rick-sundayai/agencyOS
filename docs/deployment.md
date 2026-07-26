# AgencyOS deployment runbook

Spec: docs/superpowers/specs/2026-07-18-deployment-stamps-design.md
Infra: infra/ (ops + stamp module). CI: .github/workflows/.

## Before onboarding the first real client

Run a full fleet nuke once — destroy the `staging` stamp AND the `ops` project (Artifact
Registry, WIF, TF-state bucket, deployer SA), then rebuild `ops` from a clean bootstrap —
before the first real client stamp is created. This proves the whole fleet, including WIF
trust and GitHub repo variables, stands up from zero with nothing left over from testing.
See `docs/superpowers/specs/2026-07-22-gcp-staging-poc-execution-design.md` for the exact
commands. Not required again after the first real client exists.

## Onboard a client

> **First stamp ever (staging) only:** its Terraform hardcodes `:bootstrap`-tagged images
> because no real image exists yet. Build and push them once before the very first
> `terraform apply` (skip this for every client after staging exists):
> ```bash
> AR=$(terraform -chdir=infra/ops output -raw artifact_registry)
> docker build --platform linux/amd64 --target runtime -t "$AR/app:bootstrap" .
> docker build --platform linux/amd64 --target migrate -t "$AR/migrate:bootstrap" .
> docker push "$AR/app:bootstrap"
> docker push "$AR/migrate:bootstrap"
> ```

1. Copy `infra/stamps/staging/` to `infra/stamps/<client>/`; edit `stamp_name`,
   `project_id` (e.g. `agencyos-acme`), `backend.prefix` (`stamps/<client>`),
   and optionally `custom_domain`, `db_tier`, `app_min_instances`.
2. Put JobDiva creds in `infra/stamps/<client>/secrets.auto.tfvars` (gitignored).
3. `terraform init && terraform apply` in that directory.
4. Add the stamp to `infra/stamps.json`.
5. Promote the current release: `gh workflow run promote -f tag=<tag> -f stamps=<client>`.
6. Create the client's operator user (see "First user").
7. Provision the client's n8n agent key (see "n8n agent key") — n8n's
   `AGENCYOS_AGENT_API_KEY` has no default and the agent API stays 401-locked
   until this step runs.
8. If `custom_domain` is set: add the DNS records `terraform apply` printed.

## First user
There is no signup flow, and the DB has no public IP (`ipv4_enabled = false`
by design — `cloud-sql-proxy` from a laptop cannot reach it, full stop).
Insert the operator user by running a script inside the VPC via the
`migrate` Cloud Run Job, which already has VPC access and `DATABASE_URL`
wired in and doubles as the ops-script runner (see the Dockerfile's
`migrate`-stage comment):
```bash
gcloud run jobs execute migrate --project agencyos-<client> --region us-central1 \
  --args="npx,tsx,scripts/ops/bootstrap-staging-operator.ts" --wait
gcloud secrets versions access latest --secret=onetime-operator-password --project=agencyos-<client>
VERSION=$(gcloud secrets versions list onetime-operator-password --project=agencyos-<client> \
  --filter="state=ENABLED" --sort-by=~createTime --limit=1 --format='value(name)')
gcloud secrets versions destroy "$VERSION" --secret=onetime-operator-password --project=agencyos-<client> --quiet
```
(`versions destroy` doesn't accept the `latest` alias that `versions access` does —
resolve the actual version number first.)
The password is delivered via a short-lived Secret Manager secret, not
`stdout` — Cloud Run Jobs' stdout is captured into Cloud Logging by default,
which would otherwise leak it into durable log storage. Save it to a
password manager immediately, then destroy the version as shown above.
`scripts/ops/bootstrap-staging-operator.ts` is a working reference
implementation of this pattern, but it's hardcoded to the internal ops admin
account (org "Sunday AI Work", `rick@sundayaiwork.com`) — copy and adapt the
org/email/role rather than running it as-is against a client stamp.

## n8n agent key
Each stamp needs its own real per-client key; the module ships no default.
Run via the same `migrate` job — the key is delivered the same way, via a
single shared `onetime-agent-key` Secret Manager secret (retrieve and
destroy the version immediately; it's meant for one agent at a time, not
concurrent creation of several):
```bash
gcloud run jobs execute migrate --project agencyos-<client> --region us-central1 \
  --args="npx,tsx,scripts/agents/create-agent-key.ts,--name,n8n,--org,<Client Org Name>" --wait
N8N_KEY=$(gcloud secrets versions access latest --secret=onetime-agent-key --project=agencyos-<client>)
VERSION=$(gcloud secrets versions list onetime-agent-key --project=agencyos-<client> \
  --filter="state=ENABLED" --sort-by=~createTime --limit=1 --format='value(name)')
gcloud secrets versions destroy "$VERSION" --secret=onetime-agent-key --project=agencyos-<client> --quiet
echo "N8N_KEY length: ${#N8N_KEY}"   # must print 64 before continuing
```
(`versions destroy` doesn't accept the `latest` alias that `versions access` does —
resolve the actual version number first.)
`AGENCYOS_AGENT_API_KEY` on the n8n service is wired to a Secret Manager
`secret_key_ref`, not a plain env var — `gcloud run services update
--update-env-vars` fails with a type-conflict error. Update the secret's
value instead, then force a new revision so n8n re-resolves it (Cloud Run
pins a secret's `latest` version at revision-creation time; it does not
live-track):
```bash
printf '%s' "$N8N_KEY" | gcloud secrets versions add agent-api-key --project agencyos-<client> --data-file=-
gcloud run services update n8n --project agencyos-<client> --region us-central1 \
  --revision-suffix="key-$(date +%s)"
```
Verify it actually authenticates, not just that it's 401-guarded without one.
Note this checks the DB-backed `agents` table (`requireAgentKey` in
`src/lib/agent-auth.ts`) — the secret update above is only for n8n's own
outgoing calls, it's not what this check reads:
```bash
APP_URL=$(terraform -chdir=infra/stamps/<client> output -raw app_url)
curl -s -o /dev/null -w '%{http_code}\n' -H "x-agent-api-key: $N8N_KEY" "$APP_URL/api/agent/decisions"
```
Expected: `200`.

## Release + promote
- Merge to main → auto-deploys staging (migrate → deploy → smoke).
- Cut a release: `git tag vX.Y.Z && git push origin vX.Y.Z`.
- Roll out: `gh workflow run promote -f tag=vX.Y.Z -f stamps=all` (or a name list).
- Cautious clients: leave them off the list; promote to them later.

## Rollback
`gh workflow run promote -f tag=<previous-tag> -f stamps=<affected>`.
Migrations are forward-only (expand-contract): never write a migration that
breaks the previous app version; removals wait one release after the code
stops using the column.

## n8n editor access
`gcloud run services proxy n8n --project agencyos-<client> --region us-central1 --port 5678`
then open http://localhost:5678. The service has no public access.
n8n workflows call the app at env `AGENCYOS_URL` with header key from
`AGENCYOS_AGENT_API_KEY`.

## Testing a live stamp

**Re-run the smoke test on demand** (same three checks CI runs after every
deploy — login page, agent-key guard, cockpit stream):
```bash
APP_URL=$(terraform -chdir=infra/stamps/<client> output -raw app_url)
SMOKE_BASE_URL="$APP_URL" npx tsx scripts/smoke.ts
```

**Log in as a human**: `$APP_URL/login`, with the operator credentials from
"First user" above.

**GCP Console** (swap `<client>` for the project id, e.g. `agencyos-staging`):
| What | Where |
|---|---|
| App/n8n requests, logs, revisions, traffic split | `console.cloud.google.com/run?project=agencyos-<client>` |
| `migrate` job execution history (also the ops-script runner) | `console.cloud.google.com/run/jobs?project=agencyos-<client>` |
| Cloud SQL — connections, CPU/memory, query insights | `console.cloud.google.com/sql/instances?project=agencyos-<client>` |
| Secret Manager — which secret versions are live | `console.cloud.google.com/security/secret-manager?project=agencyos-<client>` |
| Logs Explorer — every service, filterable | `console.cloud.google.com/logs/query?project=agencyos-<client>` |
| Uptime check + email alert on downtime | `console.cloud.google.com/monitoring/uptime?project=agencyos-<client>` |

**CLI equivalents:**
```bash
gcloud run services logs read app --project agencyos-<client> --region us-central1 --limit=50
gcloud run jobs executions list --job=migrate --project agencyos-<client> --region us-central1
gh run list --workflow=deploy-staging
gh run view <run-id> --log
```

**In the repo:**
- `docs/deployment-log.md` — narrative log of every deployment milestone and
  bug found in prod-like conditions; append here after a meaningful test
  session, not just at task boundaries.
- `.superpowers/sdd/progress.md` — local, gitignored task ledger for
  whichever plan is currently in flight.
- `git log --oneline` — every infra/app change that's actually shipped.

**Ordinary redeploy loop** once a stamp exists: just `git push` to `main` —
`deploy-staging` runs automatically (build → migrate → deploy → smoke). No
manual image builds needed after the very first bootstrap.

## Database access (break-glass)
`cloud-sql-proxy agencyos-<client>:us-central1:agencyos` with your IAM user;
credentials for the `app` user are in Secret Manager (`database-url`).
All access is audited via Cloud Audit Logs.

## Offboard a client
1. Final export if contracted (pg_dump via Cloud SQL Auth Proxy).
2. Remove from `infra/stamps.json`.
3. `terraform destroy` in `infra/stamps/<client>/` (flip `deletion_protection`
   on the SQL instance and `deletion_policy` on the project first), or delete
   the GCP project outright — project deletion is the provable data-deletion
   event; record its timestamp for the client.

## Costs (per idle stamp, rough)
Cloud SQL db-g1-small ~$25/mo + n8n min-instance ~$10-15/mo + storage/logs.
App scales to zero unless `app_min_instances = 1`.

## Compliance posture
- All services in the stamp are BAA-coverable (Cloud Run, Cloud SQL, Vertex AI,
  Secret Manager). HIPAA client: execute Google BAA before any PHI enters.
- Secrets only in Secret Manager. No public DB. Least-privilege SAs.
- Embeddings/AI calls stay in the stamp's project via Vertex (`VERTEX_PROJECT`).
