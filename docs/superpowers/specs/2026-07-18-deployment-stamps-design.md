# Deployment: per-client stamps on GCP

**Date:** 2026-07-18
**Status:** Approved design (brainstorm output)
**Owner:** Rick Love

## Goal

Take AgencyOS from local-only (`next dev` against local Postgres) to a repeatable,
scalable production deployment that one person can operate today and a small team
can operate later, serving SMB clients (recruiting, accounting, medical offices)
under a strong privacy/security baseline.

## Decisions

| Fork | Decision |
| --- | --- |
| Tenancy | **One instance per client** ("stamp"). No shared multi-tenant DB; no tenant model added to the code. |
| Compliance bar | **Strong baseline now, HIPAA-eligible later.** Every chosen service must be coverable by Google's BAA so a medical client never forces a re-platform. |
| Platform | **GCP: Cloud Run + Cloud SQL Postgres.** |
| Agent runtime | **Self-hosted n8n per stamp** (n8n Cloud excluded — outside the compliance boundary). |
| Isolation | **One GCP project per client**, under a `clients/` folder in the org. |

## Architecture

### The stamp (one per client, plus one staging stamp)

Each stamp is a GCP project containing:

- **Cloud Run service `app`** — AgencyOS Next.js app as a standalone container.
  Cloud Run supports the SSE endpoint (`/api/cockpit/stream`) and `force-dynamic`
  routes. `min-instances=0` by default; raise to 1 per client if cold starts hurt.
- **Cloud Run service `n8n`** — self-hosted n8n image. Editor UI behind
  Identity-Aware Proxy (operator-only). Webhooks call the app's `/api/agent/*`
  routes with the stamp's `AGENT_API_KEY`. n8n state lives in its own database on
  the stamp's Cloud SQL instance.
- **Cloud SQL Postgres** — smallest usable tier, **private IP only**, `pgvector`
  extension enabled (embeddings), automated daily backups + point-in-time recovery.
- **Secret Manager** — `DATABASE_URL`, `AUTH_SECRET`, `AGENT_API_KEY`, JobDiva
  credentials. Injected into Cloud Run as secret references; never in env files or
  the repo.
- **Vertex AI** — all Gemini calls go through Vertex (service-account auth), not
  the consumer Gemini API key. Same models; BAA-eligible; per-project quota/billing.
- **DNS** — `<client>.<base-domain>` mapped to the `app` service.
- **Monitoring** — Cloud Monitoring uptime check on the app; alerts to operator
  email/Slack.

### Fleet layout

- GCP organization with folders:
  - **`ops` project** — Artifact Registry (container images), Terraform state
    bucket, CI service accounts.
  - **`clients/` folder** — one project per client stamp.
  - **Staging** — a stamp like any other (same Terraform module, fixture data).
    Staging cannot drift from production because it *is* the production shape.
- **Terraform**: a single `stamp` module. Onboarding a client = a small tfvars
  file + `terraform apply`. Offboarding = delete the project — a provable,
  auditable data deletion.

## CI/CD (GitHub Actions)

- **PR:** `vitest run`, `tsc --noEmit`, `next build`.
- **Merge to main:** build the app image (and n8n image when changed) → push to
  Artifact Registry → deploy to the staging stamp → run `drizzle-kit migrate` as a
  Cloud Run Job → smoke test (login page renders, cockpit stream connects, agent
  ping with key succeeds).
- **Release:** operator cuts a version tag. A promote workflow rolls that image
  tag across client stamps — all of them or a named subset, so a cautious client
  can lag a version.
- **Rollback:** redeploy the previous image tag. Migrations are **forward-only**
  with expand-contract discipline, so version N−1 code always runs against
  version N schema.
- **Auth:** GitHub → GCP via Workload Identity Federation. No long-lived cloud
  keys stored in GitHub.
- **Prod data:** `db:seed` (dev fixtures) is never run against a client stamp.

## Security & compliance

**Baseline (day one):**

- Cloud SQL on private IP; no public database endpoints.
- Per-service least-privilege service accounts (app SA ≠ n8n SA ≠ CI SA).
- Encryption at rest and in transit (GCP defaults).
- Cloud Audit Logs enabled with defined retention.
- Secrets exclusively in Secret Manager.
- n8n editor reachable only through IAP.
- App auth via next-auth; `/api/agent/*` guarded by per-stamp `AGENT_API_KEY`.

**HIPAA path (when a medical client signs):**

- Execute Google's BAA. Cloud Run, Cloud SQL, and Vertex AI are BAA-covered —
  no architectural change required.
- Add CMEK if the client demands customer-managed keys.
- Remaining lift is policy/paperwork (risk analysis, access policies, training),
  not engineering.

## Cost model

Idle stamp ≈ **$30–60/month** (Cloud SQL + one warm n8n instance dominate; the
app scales to ~zero). Priced into each client contract. Per-client billing is
native because each stamp is its own GCP project.

## Codebase changes this design requires

1. `next.config.ts`: `output: "standalone"`; add a production `Dockerfile`
   (verify the next@16.2.10 + next-auth v5 beta build behaves in the container).
2. Swap Gemini SDK call path to Vertex AI with Application Default Credentials
   (replaces `GEMINI_API_KEY`).
3. Revisit the `postgres` client's `max: 1` pool settings for Cloud Run
   concurrency (per-instance pool sizing vs. Cloud SQL connection limits).
4. A deploy-time migration entrypoint (`drizzle-kit migrate`) runnable as a
   Cloud Run Job.

## Out of scope (deliberately)

- Multi-tenant schema work — excluded by the stamp decision.
- Kubernetes/GKE — Cloud Run covers the need with far less to operate.
- Centralized cross-stamp log aggregation — revisit when the fleet is >~5 stamps.
- EU data residency — no EU client yet; region is a tfvars input, so a future EU
  stamp is a variable change, not a redesign.

## Testing / verification

- Staging stamp receives every main-branch deploy and runs the smoke test.
- Existing vitest suite (188 tests) gates every PR.
- Terraform `plan` output reviewed before any client-stamp `apply`.
