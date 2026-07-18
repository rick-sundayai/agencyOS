# Disaster Recovery & Backups

**Date:** July 2026  
**Scope:** AgencyOS Production Fleet

## 1. Overview

AgencyOS utilizes Google Cloud Platform's managed infrastructure to ensure high availability and data durability. Because of the Per-Client Stamp architecture, a catastrophic failure is generally isolated to a single client project rather than the entire fleet.

## 2. Recovery Objectives

AgencyOS maintains the following targets for disaster recovery scenarios (e.g., database corruption, accidental data deletion via application bug):

- **Recovery Point Objective (RPO):** 1 Hour (Maximum acceptable data loss).
- **Recovery Time Objective (RTO):** 24 Hours (Maximum acceptable downtime during restoration).

## 3. Backup Mechanisms

- **Database (Cloud SQL):** Automated daily backups are enabled on all client Cloud SQL instances. Additionally, Point-in-Time Recovery (PITR) is enabled via write-ahead logging (WAL), allowing database restoration to any specific second within the retention window (typically 7 days).
- **Application Compute:** The AgencyOS application and n8n agents are stateless containers hosted on Cloud Run. No backups are required for compute; recovery is achieved by redeploying the immutable Docker image from the GCP Artifact Registry.
- **Infrastructure:** Infrastructure state is managed via Terraform. Recovery of deleted infrastructure components is achieved by re-applying the Terraform configuration.

## 4. Restoration Procedure

If a database must be restored from a backup:

1. The Operator locates the Cloud SQL instance in the affected client's GCP Project.
2. A new Cloud SQL instance is cloned from the specified Point-in-Time.
3. The Secret Manager `DATABASE_URL` is updated to point to the new instance's private IP.
4. The Cloud Run application and n8n services are restarted to establish connections to the restored database.
