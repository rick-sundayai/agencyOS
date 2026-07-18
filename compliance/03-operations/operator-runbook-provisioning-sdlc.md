# Operator Runbook: Provisioning & SDLC

**Date:** July 2026  
**Operator:** Authorized System Administrator only.

## 1. Client Onboarding (Provisioning a Stamp)

Adding a new client provisions a completely isolated GCP project.

### Step 1: Configure Terraform

- Create a new variable file: `infra/clients/<client-name>.tfvars`.
- Define the target GCP Region, Base Domain, and initial user emails.

### Step 2: Apply Infrastructure

- Ensure you are authenticated to GCP CLI (`gcloud auth application-default login`).
- Run `terraform workspace new <client-name>` (or use your preferred state separation).
- Run `terraform apply -var-file="clients/<client-name>.tfvars"`.

### Step 3: DNS & Post-Provisioning

- Take the Cloud Run URL outputted by Terraform and add a CNAME record in the domain registrar mapping `<client-name>.agencyos.dev` to the service.
- The database is initialized automatically via the Terraform-triggered Cloud Run Migration Job.

## 2. Software Development Life Cycle (SDLC) & Deployment

Application code changes are deployed via GitHub Actions.

### Continuous Integration (CI)

- All PRs to `main` must pass the `vitest` suite and `next build` validation.

### Staging Deployment

- Merging to `main` triggers an image build. The image is pushed to Artifact Registry.
- The pipeline deploys this image to the Staging Stamp (a GCP project identical to production).
- Database migrations run against the Staging database.

### Production Deployment (Promotion)

- Once staging is verified, the Operator creates a GitHub Release/Tag (e.g., `v1.2.0`).
- A GitHub Action workflow promotes this specific container image to the production client stamps by updating the Cloud Run service revisions.
