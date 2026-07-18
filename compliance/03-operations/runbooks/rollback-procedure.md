# Rollback Procedure

**Emergency rollback for failed deployments.**

⏱️ **Target Time:** 5 minutes from decision to rollback complete  
📋 Refer to [Incident Response Checklist](incident-response-checklist.md) for how to diagnose a bad deployment.

---

## Pre-Rollback (Decision Making)

Use this checklist to confirm a rollback is needed:

- [ ] **Is this a deployment issue?**
  - [ ] Was a new image deployed to this Cloud Run service in the last 2 hours?
  - [ ] Application is crashing, unresponsive, or returning 500 errors?
  - [ ] No recent database migrations or infrastructure changes?
  - **If YES to all:** Proceed with rollback

- [ ] **Is a rollback safe?**
  - [ ] Did a database migration run with this deployment?
  - [ ] If YES: Database schema is newer than previous app version — **check compatibility** before rollback
  - [ ] Ref: [Disaster Recovery & Backups](../disaster-recovery-backups.md) note on expand-contract migrations
  - [ ] **If safe:** Proceed

---

## Step 1: Access GCP Console (1-2 min)

- [ ] Open browser → https://console.cloud.google.com
- [ ] **Authenticate:**
  - [ ] Use your Google Workspace account
  - [ ] Provide MFA (Authenticator app or hardware key — NOT SMS)
  - [ ] Select correct GCP project (affected client's project)

- [ ] Navigate to **Cloud Run** service
  - [ ] Left sidebar: **Cloud Run**
  - [ ] Select region: **us-central1** (or appropriate region)
  - [ ] Click service name: typically `agencyos-app-<environment>` or `n8n-runtime`

---

## Step 2: Identify Current & Previous Revisions (1 min)

- [ ] View **Revisions** tab
  - [ ] **Current (100% traffic):** The revision that's broken
  - [ ] **Previous (0% traffic):** The stable revision to roll back to
  
- [ ] Verify previous revision:
  - [ ] Status: **Ready** (green checkmark)
  - [ ] Created timestamp: Shows when it was deployed (should be 1-7 days ago)
  - [ ] Image tag: Should be previous stable version (e.g., `v1.2.0` or git SHA)

- [ ] **If no previous revision:**
  - ⚠️ **STOP** — Cannot rollback, only option is fix-forward
  - Escalate to architecture team for advice on immediate patch deployment

---

## Step 3: Shift Traffic (1-2 min)

- [ ] Click **Manage Traffic** button
- [ ] Dialog opens: Shows traffic split across revisions
- [ ] **Change traffic allocation:**
  - [ ] Current broken revision: Set to **0%**
  - [ ] Previous stable revision: Set to **100%**
  - [ ] Other revisions: Leave at 0%

- [ ] Click **Save**
  - [ ] Cloud Run begins redirecting traffic
  - [ ] Status changes to "Updating traffic split" (takes ~10-30 seconds)
  - [ ] Wait for status to return to "Ready"

---

## Step 4: Verify Rollback (2-3 min)

- [ ] **Check uptime:**
  - [ ] Cloud Monitoring → Uptime Checks
  - [ ] Is the affected client's check passing? Wait for next check cycle (~1 min)
  - [ ] Or manually: `curl https://<client-domain>/healthz` should return 200 OK

- [ ] **Check application logs:**
  - [ ] Cloud Logging → Filter: `resource.type=cloud_run_revision AND severity=ERROR`
  - [ ] Should see NO errors in the last 2 minutes (or only baseline errors)

- [ ] **Quick user verification:**
  - [ ] Ask client (if they reported the issue): "Can you access the app now?"
  - [ ] Try accessing the app yourself from a browser

- [ ] **If working:**
  - ✅ Rollback successful
  - Proceed to Step 5 (Communication)

- [ ] **If still broken:**
  - ⚠️ Previous revision is also broken
  - Escalate immediately — may need database restore or infrastructure fix
  - See [Disaster Recovery & Backups](../disaster-recovery-backups.md)

---

## Step 5: Communication (1 min)

- [ ] **Notify Client**
  - Subject: `Incident Resolved: <Client Name> Service Restored`
  - Body:
    ```
    We detected a deployment issue and have rolled back to the previous stable version.
    Your service is now fully restored and operational.
    
    Root Cause: [brief description of what was deployed]
    Resolution: Reverted application to previous version
    Impact: ~X minutes of downtime
    
    We'll send a detailed post-mortem within 24 hours.
    ```

- [ ] **Document the Rollback**
  - [ ] Note timestamp of rollback
  - [ ] Note which revision was rolled back from
  - [ ] Note which revision was rolled back to
  - [ ] Add to internal incident log

---

## Step 6: Post-Rollback (within 24 hours)

- [ ] **Root Cause Analysis**
  - [ ] What was in the bad deployment?
  - [ ] Why didn't staging tests catch it?
  - [ ] Can we add tests to prevent this?

- [ ] **Fix-Forward Decision**
  - [ ] Should we apply a patch and redeploy?
  - [ ] Or revert the GitHub PR and fix locally?

- [ ] **Update Runbook**
  - [ ] Did we learn anything new? Update this checklist.

---

## Troubleshooting

### Traffic Shift Doesn't Update
- **Problem:** Click save but traffic allocation doesn't change
- **Solution:** 
  - Refresh page (Ctrl+R)
  - Check if you have Cloud Run Admin role in this project
  - Try again in 30 seconds

### Previous Revision Also Broken
- **Problem:** After rollback, service still returns errors
- **Solution:**
  - Check [Disaster Recovery & Backups](../disaster-recovery-backups.md) for database restore
  - Incident may be infrastructure-related, not deployment-related
  - Escalate to infrastructure team

### Can't Access GCP Console
- **Problem:** MFA fails, authentication hangs
- **Solution:**
  - Verify device complies with [Workstation & Endpoint Security Policy](../../01-policies/workstation-endpoint-security.md)
  - Try logging out and logging in again
  - Use a different device if available

---

## Quick Reference

### Cloud Run Revision Page
Navigate: https://console.cloud.google.com/run/detail/<REGION>/<SERVICE_NAME>/revisions

### Manual Traffic Shift (if UI fails)
```bash
gcloud run services update-traffic <SERVICE_NAME> \
  --to-revisions <STABLE_REVISION>=100,<BROKEN_REVISION>=0 \
  --region=us-central1
```

### Check Traffic Allocation
```bash
gcloud run services describe <SERVICE_NAME> --region=us-central1 --format='value(status.traffic)'
```

---

## Decision Tree

```
Bad Deployment Detected?
├─ YES: Is previous revision stable?
│  ├─ YES: Execute rollback (Steps 1-4)
│  └─ NO: Infrastructure issue — see Disaster Recovery
└─ NO: Not deployment issue — see Incident Response Checklist
```

---

*Last updated: 2026-07-18 | Owner: System Administrator*
