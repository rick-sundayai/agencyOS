# System Architecture & Trust Boundaries

**Date:** July 2026  
**Scope:** AgencyOS Production Fleet

## 1. Overview

AgencyOS utilizes a "Per-Client Stamp" architecture deployed on Google Cloud Platform (GCP). To guarantee absolute data isolation, compliance, and billing accuracy, a multi-tenant database approach is strictly prohibited. Every client operates within their own dedicated GCP Project.

## 2. Trust Boundaries & Isolation

The primary trust boundary is the GCP Project boundary.

- **Compute Isolation:** Each client has a dedicated Cloud Run instance for the Next.js Application and a dedicated Cloud Run instance for the n8n agent runtime.
- **Database Isolation:** Each client is provisioned a dedicated Cloud SQL (PostgreSQL + pgvector) instance.
- **Network Isolation:** Cloud SQL instances are strictly deployed with Private IPs. There are no public internet gateways to the databases.
- **AI/LLM Boundary:** Generative AI capabilities are routed exclusively through GCP Vertex AI using service account authentication (Application Default Credentials), rather than consumer API keys. This ensures all prompts and PII remain within the Google Cloud compliance boundary and are explicitly excluded from public model training.

## 3. Logical Access Control

- **Operator Access:** All operator access to GCP infrastructure is governed by Google Workspace Identity.
- **Agent Editor Access (n8n):** The n8n workflow editor is inaccessible from the public internet. It is shielded by GCP Identity-Aware Proxy (IAP) and requires operator authentication and authorization to access.
- **Application Authentication:** The Next.js application manages end-user access via NextAuth.
- **Service-to-Service Authentication:** The n8n agent runtime communicates with the AgencyOS Next.js API endpoints utilizing a cryptographically generated `AGENT_API_KEY` specific to that client stamp.
- **CI/CD Access:** GitHub Actions interacts with GCP resources exclusively via Workload Identity Federation (WIF). No long-lived service account JSON keys are generated, stored, or utilized.

## 4. Secret Management

No application secrets, database passwords, or third-party credentials (e.g., JobDiva) are stored in environment variables, source code, or unencrypted storage. All secrets are provisioned in GCP Secret Manager and resolved at runtime by Cloud Run.
