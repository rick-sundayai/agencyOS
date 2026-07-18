# Client Offboarding Checklist

**Complete data deletion and infrastructure teardown for departing clients.**

⏱️ **Timeline:** 1-2 hours total  
📋 Refer to [Data Retention & Deletion Policy](../../01-policies/data-retention-deletion.md) for compliance context.

---

## Pre-Offboarding Checklist (Before Day 1)

- [ ] **Receive Offboarding Request**
  - [ ] Client has formally notified us (email, contract end, or explicit data deletion request)
  - [ ] Note: Client name, project ID (if known), contract end date
  - [ ] Decision: Confirm this is final deletion (not pause/backup)

- [ ] **Communication**
  - [ ] Notify client: "We've scheduled your data deletion for [DATE]"
  - [ ] Ask: "Do you need any data exports before deletion?" (optional, but good practice)
  - [ ] Confirm: "All data will be permanently deleted via GCP project deletion"

- [ ] **Backup Verification** (optional, recommended)
  - [ ] Ask client: Want a final data export?
  - [ ] If YES: Request what data (database dump, documents, etc.)
  - [ ] Provide: Data export from Cloud SQL
  - [ ] Timeline: Allow 2-3 business days for export + delivery

- [ ] **Internal Documentation**
  - [ ] Create an internal ticket/note with:
    - Client name
    - GCP Project ID
    - Planned deletion date
    - Terraform workspace (if applicable)

---

## Day of Offboarding: Step 1 — Pre-Deletion Verification (15 min)

**Login & Verification**

- [ ] **Authenticate to GCP**
  - [ ] https://console.cloud.google.com
  - [ ] Use MFA (hardware key or Authenticator app)
  - [ ] Select the **client's GCP project** from project switcher

- [ ] **Verify Correct Project**
  - [ ] Project ID in top banner matches client project
  - [ ] Look at: Resources (Cloud Run services, Cloud SQL instance)
  - [ ] Verify this is the correct client

- [ ] **List All Resources (screenshot for audit trail)**
  - [ ] Cloud Run → List services (should see `agencyos-app-prod`, `n8n-runtime`, etc.)
  - [ ] Cloud SQL → List instances
  - [ ] Secret Manager → List secrets
  - [ ] Firestore (if used) → Collections
  - [ ] Cloud Storage (if used) → Buckets
  - [ ] **Take screenshot or note:** All resources present

- [ ] **Notify Team**
  - [ ] Slack: "Starting offboarding for [Client Name] — GCP project [PROJECT_ID]"
  - [ ] Timeline: Deletion will complete in ~30 min, resources gone in ~1 hour

---

## Step 2 — Terraform Destruction (15-20 min)

**Remove Infrastructure via Terraform (most reliable method)**

- [ ] **Authenticate Terraform to GCP**
  ```bash
  gcloud auth application-default login
  # Select the service account or user account
  # Verify: gcloud config list
  ```

- [ ] **Switch to Correct Workspace** (if using workspaces)
  ```bash
  terraform workspace list
  terraform workspace select <client-name>
  # Verify: terraform workspace show
  ```

- [ ] **Review Terraform Plan (CRITICAL)**
  ```bash
  terraform plan -destroy -var-file="infra/clients/<client-name>.tfvars"
  ```
  - [ ] Read the output carefully
  - [ ] Should show resources being **destroyed** (with `-` prefix)
  - [ ] Verify resources match those seen in GCP Console
  - [ ] **Do NOT proceed if plan shows unexpected deletions**

- [ ] **Execute Destruction**
  ```bash
  terraform apply -destroy -var-file="infra/clients/<client-name>.tfvars"
  ```
  - [ ] Type `yes` when prompted
  - [ ] Wait for completion (typically 3-5 minutes)
  - [ ] Verify: "Destroy complete! Resources: X destroyed"

- [ ] **Verify Deletion in GCP**
  - [ ] Cloud Run: No services for this client
  - [ ] Cloud SQL: Instance is gone (or scheduled for deletion)
  - [ ] Secrets: Secret Manager is empty for this client

---

## Step 3 — Manual Cleanup (if needed, 5-10 min)

**For any resources Terraform didn't catch:**

- [ ] **Firestore/Datastore** (if used)
  - [ ] Firestore → Delete all collections for this client
  - [ ] Or delete entire database

- [ ] **Cloud Storage Buckets** (if used)
  - [ ] List buckets: `gsutil ls`
  - [ ] Delete bucket: `gsutil -m rm -r gs://<bucket-name>`

- [ ] **Pub/Sub Topics** (if used)
  - [ ] List: `gcloud pubsub topics list`
  - [ ] Delete: `gcloud pubsub topics delete <topic-name>`

- [ ] **IAM Service Accounts** (if used)
  - [ ] List: `gcloud iam service-accounts list`
  - [ ] Delete: `gcloud iam service-accounts delete <service-account>`

- [ ] **VPC & Networking** (if custom)
  - [ ] VPC Networks → Delete any custom VPCs
  - [ ] Firewall Rules → Delete any custom rules

---

## Step 4 — Final Verification (5 min)

**Confirm Everything is Gone**

- [ ] **Empty Project Check**
  - [ ] Cloud Run: "No services found"
  - [ ] Cloud SQL: "No instances found"
  - [ ] Secret Manager: "No secrets found"
  - [ ] Cloud Monitoring: Alerts/dashboards gone (or at least not triggering)

- [ ] **Terraform State Check**
  ```bash
  terraform show
  # Should show empty state for this workspace (no resources)
  ```

- [ ] **GCP Audit Logs** (optional, for compliance)
  - [ ] Cloud Logging → Admin Activity
  - [ ] Filter: Last 1 hour
  - [ ] Verify deletions are logged with your user account

---

## Step 5 — Cryptographic Erasure (Background)

**This happens automatically via GCP project lifecycle:**

- [ ] **GCP Project Deletion** (handled by GCP)
  - [ ] All resources are destroyed ✓
  - [ ] Encryption keys are rotated/destroyed ✓
  - [ ] Backups and PITR logs are scheduled for deletion ✓
  - [ ] Data is cryptographically unrecoverable ✓
  - Timeline: GCP completes project deletion within ~30 days

- [ ] **Cloud SQL Automated Backups**
  - [ ] Any automated backups in the project are also deleted
  - [ ] PITR logs are purged after project deletion

- [ ] **Artifact Registry** (Container Images)
  - [ ] If using shared Artifact Registry: manually delete client images
  - [ ] If dedicated to this project: automatically deleted with project

---

## Step 6 — Documentation & Compliance (10 min)

- [ ] **Update Terraform State**
  - [ ] Remove client workspace: `terraform workspace delete <client-name>`
  - [ ] Commit state changes: `git add . && git commit -m "chore: remove offboarded client [CLIENT_NAME]"`

- [ ] **Internal Audit Trail**
  - [ ] Document: Date, time, person who performed offboarding
  - [ ] Document: GCP project ID, resources deleted
  - [ ] Save: Screenshot of empty project (optional, for audit)

- [ ] **Notify Stakeholders**
  - [ ] Client: "Your data has been deleted and is no longer recoverable"
  - [ ] Finance: Client can be removed from billing
  - [ ] Legal: Offboarding complete, data deletion verified

- [ ] **Archive Compliance Evidence** (if required)
  - [ ] Save offboarding checklist + audit notes to secure location
  - [ ] Reference: [Data Retention & Deletion Policy](../../01-policies/data-retention-deletion.md)

---

## Troubleshooting

### Terraform Destroy Fails
- **Problem:** `terraform apply -destroy` shows errors
- **Solution:**
  - Check Terraform workspace is correct: `terraform workspace show`
  - Verify credentials: `gcloud auth list`
  - Try destroying individual resources via GCP Console
  - Check Terraform state: `terraform state list`

### Some Resources Remain After Terraform Destroy
- **Problem:** Cloud SQL still visible in Console after Terraform destroy
- **Solution:**
  - GCP marks some resources for deletion (takes up to 1 hour)
  - Manually delete via Console if urgent
  - Or use `gcloud sql instances delete <instance-name>`

### Can't Delete Due to Existing Backups
- **Problem:** Cloud SQL deletion blocked due to automated backups
- **Solution:**
  - Disable automated backups first
  - Then delete the instance

### Wrong Project Deleted (Oops!)
- **Problem:** Accidentally deleted wrong client's project
- **Solution:** ⚠️ **CRITICAL INCIDENT**
  - Stop immediately, escalate to architecture team
  - Contact GCP support (project deletion can be halted within ~30 min)
  - Check if GCP has a recovery window

---

## Quick Reference

### Verify Project ID Before Starting
```bash
gcloud config list
gcloud config set project <CLIENT_PROJECT_ID>
```

### List All Resources in Project
```bash
gcloud compute resources list  # Not all resources
gcloud run services list
gcloud sql instances list
gcloud secrets list
```

### Delete Single Resources (Emergency)
```bash
# Cloud Run service
gcloud run services delete <SERVICE_NAME> --region=us-central1

# Cloud SQL instance
gcloud sql instances delete <INSTANCE_NAME>

# Secret
gcloud secrets delete <SECRET_NAME>
```

---

## Offboarding Checklist Summary

| Phase | Task | Status |
|-------|------|--------|
| Pre-Offboarding | Receive request, communicate, backup | ☐ |
| Verification | Login, verify project, screenshot resources | ☐ |
| Destruction | Run Terraform destroy, verify deletion | ☐ |
| Manual Cleanup | Delete any manual resources | ☐ |
| Final Verification | Confirm empty project | ☐ |
| Cryptographic Erasure | GCP project lifecycle (automatic) | ☐ |
| Documentation | Update Terraform, audit trail, notify team | ☐ |

---

## Compliance Notes

- ✅ **GDPR Compliant:** Data deleted via cryptographic erasure (irreversible)
- ✅ **SOC 2 Compliant:** Auditable deletion process with documented evidence
- ✅ **Data Protection:** Encryption keys destroyed, no recovery possible

See [Data Retention & Deletion Policy](../../01-policies/data-retention-deletion.md) for policy details.

---

*Last updated: 2026-07-18 | Owner: System Administrator*
