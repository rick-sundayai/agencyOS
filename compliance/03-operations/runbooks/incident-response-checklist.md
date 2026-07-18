# Incident Response Checklist

**Quick-reference operational checklist for incident triage and response.**

⏱️ Use this during an active incident. Refer to [Incident Response & Monitoring](../incident-response-monitoring.md) for detailed procedures.

---

## Phase 1: Detection & Confirmation (0-15 min)

- [ ] **Receive Alert**
  - Alert received via AgencyOS Admin Email
  - Note: timestamp, affected client (if known), alert type

- [ ] **Confirm Incident**
  - [ ] Log into GCP Console (use MFA + hardware key)
  - [ ] Navigate to affected client's project
  - [ ] Check Cloud Monitoring uptime checks — is the `/healthz` endpoint responding?
  - [ ] Check Cloud Logging for errors in the last 5 minutes
  - [ ] Verify it's not a transient network glitch (check multiple times, 30-second intervals)
  
- [ ] **Scope the Incident**
  - [ ] Is this a single client or fleet-wide?
  - [ ] Is this infrastructure (Cloud Run, Cloud SQL, IAP) or application logic?
  - [ ] Note affected components: Application / Database / Networking / Deploy Pipeline

- [ ] **Declare Incident Status**
  - [ ] **CONFIRMED:** Incident is real, customer-facing impact likely
  - [ ] **INVESTIGATING:** Root cause unclear, gathering data
  - [ ] **FALSE ALARM:** Transient issue or alert misconfiguration

---

## Phase 2: Triage & Initial Response (15-45 min)

**If CONFIRMED:**

- [ ] **Assess Severity**
  - [ ] **P1 (Critical):** All traffic failing, database down, widespread impact
  - [ ] **P2 (High):** Partial degradation, specific features broken, single large client affected
  - [ ] **P3 (Medium):** Performance degradation, background jobs failing, minor features broken

- [ ] **Gather Logs**
  - [ ] Cloud Run Application Logs: `gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=<service>"` (last 15 min)
  - [ ] Cloud SQL Logs: Check database CPU, memory, connection count in Cloud Monitoring
  - [ ] Network: Check Identity-Aware Proxy logs for authentication failures
  - [ ] For deployments: Check Cloud Build logs for recent failed builds

- [ ] **Check Recent Changes**
  - [ ] Was a deployment pushed to production in the last 2 hours?
  - [ ] Review GitHub Actions workflow for the latest promotion
  - [ ] Check if database migration ran unexpectedly
  - [ ] Look for any Terraform state changes (infrastructure drift)

- [ ] **Contact Client (if applicable)**
  - [ ] **P1/P2:** Email client within 15 minutes of confirmation
  - [ ] Include: What we know, what we're doing, ETA for next update
  - [ ] Template: "We've detected an incident affecting your service. Our team is investigating. We'll update you within 1 hour."

---

## Phase 3: Remediation (depends on root cause)

### If Bad Deployment (Application)
- [ ] Proceed to [Rollback Procedure](rollback-procedure.md)

### If Database Issue
- [ ] Check Cloud SQL resource metrics (CPU, memory, connections, disk)
- [ ] Check for long-running queries: `SELECT * FROM pg_stat_statements WHERE mean_exec_time > 1000 LIMIT 10`
- [ ] If corrupted data: Consider restore from Point-in-Time Recovery (see [Disaster Recovery & Backups](../disaster-recovery-backups.md))
- [ ] If connection pool exhausted: Restart Cloud Run service to reset connections

### If Network/IAP Issue
- [ ] Check Identity-Aware Proxy logs for auth failures
- [ ] Verify service account has correct IAM roles
- [ ] Check firewall rules (GCP → VPC → Firewall)
- [ ] Restart Cloud Run service if connectivity stuck

### If Infrastructure Issue
- [ ] Re-apply Terraform: `terraform apply -var-file="clients/<client-name>.tfvars"`
- [ ] Verify all GCP resources are running (Cloud Run revisions, Cloud SQL instance, etc.)

---

## Phase 4: Communication & Resolution (ongoing)

- [ ] **Update Client Every 60 minutes**
  - Status: Investigating / Remediating / Resolved
  - What we've done so far
  - Next steps / ETA

- [ ] **Resolve & Verify**
  - [ ] Uptime check is green (passing 3 consecutive checks)
  - [ ] Application is responding normally on `/healthz`
  - [ ] No errors in Cloud Logging (or only expected errors)
  - [ ] Client has acknowledged recovery

- [ ] **Post-Incident Communication**
  - [ ] Send final summary to client (within 4 hours of resolution)
  - [ ] Include: What happened, why, how it was fixed, prevention measures

---

## Phase 5: Post-Incident Review (within 24 hours)

- [ ] **Root Cause Analysis**
  - [ ] What failed?
  - [ ] Why did it fail?
  - [ ] What did we miss in monitoring/alerting?

- [ ] **Action Items**
  - [ ] Any deployment issues? Add tests or safer rollout strategy
  - [ ] Any monitoring gaps? Improve alert thresholds
  - [ ] Any runbook issues? Update this checklist

- [ ] **Document**
  - [ ] Add entry to incident log (internal wiki or spreadsheet)
  - [ ] Update this runbook if new patterns discovered

---

## Quick Reference

### GCP Console Navigation
```bash
# View project: https://console.cloud.google.com/home/dashboard?project=<client-project-id>
# Cloud Monitoring: https://console.cloud.google.com/monitoring
# Cloud Logging: https://console.cloud.google.com/logs
# Cloud Run: https://console.cloud.google.com/run
# Cloud SQL: https://console.cloud.google.com/sql
```

### Common gcloud Commands
```bash
# View recent Cloud Run deployments
gcloud run revisions list --service=<service-name> --region=us-central1

# Tail application logs
gcloud logging read "resource.type=cloud_run_revision" --tail --limit 50

# Check Cloud SQL CPU
gcloud sql operations list --instance=<instance-name>

# View IAM bindings
gcloud iam service-accounts get-iam-policy <service-account>@<project>.iam.gserviceaccount.com
```

---

## Escalation

**If you're stuck or unsure:**
- Check [Incident Response & Monitoring](../incident-response-monitoring.md) for detailed procedures
- Check [Disaster Recovery & Backups](../disaster-recovery-backups.md) for restoration
- Check [Rollback Procedure](rollback-procedure.md) for deployment issues

**For infrastructure/GCP questions:**
- GCP Documentation: https://cloud.google.com/docs
- Cloud Run: https://cloud.google.com/run/docs
- Cloud SQL: https://cloud.google.com/sql/docs

---

*Last updated: 2026-07-18 | Owner: On-Call Lead*
