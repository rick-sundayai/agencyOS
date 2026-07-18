# AgencyOS deployment runbook

Spec: docs/superpowers/specs/2026-07-18-deployment-stamps-design.md
Infra: infra/ (ops + stamp module). CI: .github/workflows/.

## Onboard a client
1. Copy `infra/stamps/staging/` to `infra/stamps/<client>/`; edit `stamp_name`,
   `project_id` (e.g. `agencyos-acme`), `backend.prefix` (`stamps/<client>`),
   and optionally `custom_domain`, `db_tier`, `app_min_instances`.
2. Put JobDiva creds in `infra/stamps/<client>/secrets.auto.tfvars` (gitignored).
3. `terraform init && terraform apply` in that directory.
4. Add the stamp to `infra/stamps.json`.
5. Promote the current release: `gh workflow run promote -f tag=<tag> -f stamps=<client>`.
6. Create the client's operator user (see "First user").
7. If `custom_domain` is set: add the DNS records `terraform apply` printed.

## First user
There is no signup flow. Insert the operator user directly (bcrypt hash):
run `npx tsx` locally with DATABASE_URL pointed at the stamp via the Cloud SQL
Auth Proxy, and insert into `users` the way `src/db/seed.ts` does — but ONLY the
user row. Never run `db:seed` itself against a stamp.

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
