# Data Retention & Deletion Policy

**Date:** July 2026  
**Scope:** AgencyOS Production Fleet

## 1. Overview

Due to the Per-Client Stamp architecture, AgencyOS data lifecycle management is intrinsically tied to infrastructure lifecycle management via Terraform.

## 2. Client Offboarding & Data Deletion

When a client terminates their contract or requests data deletion, the process is executed via Infrastructure as Code (IaC):

1. The operator removes the client's configuration block/tfvars from the Terraform state.
2. The operator executes a Terraform apply/destroy scoped to that client.
3. The entire GCP Project assigned to that client is scheduled for deletion by Google Cloud.

## 3. Cryptographic Erasure

By deleting the GCP Project, all underlying resources are destroyed. Because Google Cloud encrypts all data at rest by default:

- The Cloud SQL storage volumes are destroyed.
- The encryption keys used to secure the disks are destroyed.
- This constitutes a mathematically irreversible cryptographic erasure of all client data, Candidate PII, resumes, and agent memory.

## 4. Backups and Retention

- Automated daily backups and Point-in-Time Recovery (PITR) logs are maintained by Cloud SQL.
- When the primary database is destroyed via project deletion, these backups are also subjected to Google Cloud's standard project deletion lifecycle and are rendered permanently irretrievable.
