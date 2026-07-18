# AgencyOS Compliance Documentation

Master index for all compliance, security, and operational policies governing AgencyOS production infrastructure.

---

## Quick Navigation

| Document | Purpose | Audience | Last Updated |
|----------|---------|----------|--------------|
| **Policies** | | | |
| [Workstation & Endpoint Security Policy](01-policies/workstation-endpoint-security.md) | Device security baseline for operators | Operators, IT Security | 2026-07-18 |
| [Data Retention & Deletion Policy](01-policies/data-retention-deletion.md) | Client data lifecycle & offboarding procedures | Operators, Legal, Clients | 2026-07-18 |
| **Architecture** | | | |
| [System Architecture & Trust Boundaries](02-architecture/system-architecture-trust-boundaries.md) | Infrastructure design, isolation, access control | Architects, Operators, Auditors | 2026-07-18 |
| **Operations** | | | |
| [Operator Runbook: Provisioning & SDLC](03-operations/operator-runbook-provisioning-sdlc.md) | Client onboarding, deployment workflows | Operators, DevOps | 2026-07-18 |
| [Incident Response & Monitoring](03-operations/incident-response-monitoring.md) | Alerting, escalation, incident handling | Operators, On-Call | 2026-07-18 |
| [Disaster Recovery & Backups](03-operations/disaster-recovery-backups.md) | RTO/RPO targets, backup procedures, restoration | Operators, DRI | 2026-07-18 |
| **Checklists** | | | |
| [Incident Response Checklist](03-operations/runbooks/incident-response-checklist.md) | Step-by-step incident triage | On-Call Operators | TBD |
| [Rollback Procedure](03-operations/runbooks/rollback-procedure.md) | Emergency rollback steps | Operators | TBD |
| [Client Offboarding Checklist](03-operations/runbooks/client-offboarding.md) | Data deletion & infrastructure teardown | Operators | TBD |

---

## Document Overview

### Policies (01-policies/)
Baseline requirements and constraints that govern how AgencyOS operates.

**Workstation & Endpoint Security Policy**
- Full disk encryption, screen lock, OS updates
- MFA requirements, credential handling
- Applies to: All operators accessing GCP Console or Terraform state

**Data Retention & Deletion Policy**
- Client data lifecycle tied to infrastructure lifecycle
- Cryptographic erasure via GCP project deletion
- Backup retention and compliance

### Architecture (02-architecture/)
System design, trust boundaries, and isolation guarantees.

**System Architecture & Trust Boundaries**
- Per-Client Stamp architecture
- Network & database isolation
- Access control (operator, agent, application, service-to-service)
- Secret management via GCP Secret Manager

### Operations (03-operations/)
Procedural documentation for running and maintaining AgencyOS.

**Operator Runbook: Provisioning & SDLC**
- Client onboarding (Terraform provisioning)
- Deployment pipeline (CI → Staging → Production)
- DNS configuration

**Incident Response & Monitoring**
- Monitoring & alerting setup
- Escalation procedures
- Rollback procedures for failed deployments

**Disaster Recovery & Backups**
- RTO: 24 hours, RPO: 1 hour
- Database backup and PITR
- Restoration procedures

---

## Compliance Frameworks

This documentation addresses:
- **SOC 2 Type II** (Security, Availability, Confidentiality)
- **GDPR** (Data processing, deletion, isolation)
- **Data Protection** (Encryption at rest/transit, access control)

---

## Review & Update Schedule

| Document | Review Frequency | Next Review | Owner |
|----------|------------------|-------------|-------|
| Workstation & Endpoint Security Policy | Annual | 2027-07-18 | System Administrator |
| Data Retention & Deletion Policy | Annual | 2027-07-18 | System Administrator + Legal |
| System Architecture & Trust Boundaries | Annual | 2027-07-18 | Infrastructure Architect |
| Operator Runbook: Provisioning & SDLC | Quarterly | 2026-10-18 | DevOps / System Administrator |
| Incident Response & Monitoring | Quarterly | 2026-10-18 | On-Call Lead |
| Disaster Recovery & Backups | Bi-annually | 2027-01-18 | System Administrator |

See [METADATA.yaml](METADATA.yaml) for complete version history.

---

## How to Use This Documentation

### For Operators
1. Start with **System Architecture & Trust Boundaries** to understand the landscape
2. Review **Workstation & Endpoint Security Policy** to ensure your device is compliant
3. Follow the **Operator Runbooks** for routine tasks (provisioning, deployment, incident response)

### For Auditors
1. Review **METADATA.yaml** for version and review history
2. Cross-reference **System Architecture** with **Policies** to verify controls
3. Check **CHANGELOG.md** for recent modifications

### For Clients
1. Request specific documents via your account manager
2. Typically relevant: System Architecture (data isolation), Disaster Recovery (RTO/RPO), Data Retention (deletion procedures)

---

## Document Control

- **Repository:** AgencyOS (rick-sundayai/agencyOS)
- **Path:** `/compliance/`
- **Format:** Markdown (version-controlled)
- **Change Log:** See [CHANGELOG.md](CHANGELOG.md)
- **Last Updated:** 2026-07-18

---

## Questions or Updates?

- **Policy clarification:** Contact System Administrator
- **Operational procedures:** Refer to runbooks or escalate via incident channel
- **Audit access:** Contact System Administrator

---

*This is a living document. All changes are tracked in CHANGELOG.md. Last master review: 2026-07-18.*
