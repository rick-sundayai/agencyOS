# Incident Response & Monitoring

**Date:** July 2026  
**Scope:** AgencyOS Production Fleet

## 1. Monitoring & Alerting

AgencyOS utilizes GCP Cloud Monitoring to track the health of all client stamps.

- **Uptime Checks:** HTTP health checks run continuously against each client's Next.js application `/healthz` endpoint.
- **Alert Routing:** If an uptime check fails consecutively or database CPU/Memory usage breaches 90%, an alert is immediately dispatched to the AgencyOS Admin Email Address.

## 2. Incident Escalation (Current Phase)

AgencyOS is currently managed under a single-operator model.

- **Tier 1 & Tier 2:** The primary System Administrator receives the email alert and investigates via the GCP Console and Cloud Logging.
- **Communication:** If an incident causes a client-facing outage, the System Administrator will notify the affected client via email within 4 hours of incident confirmation.

## 3. Rollback Procedure (Bad Deployment)

Because AgencyOS utilizes immutable container images on Cloud Run, rollbacks do not require compiling or reverting code:

1. The Operator navigates to the affected client's Cloud Run service.
2. The traffic routing is updated to shift 100% of traffic back to the previously known-good image tag/revision.
3. **Note on Databases:** Database migrations (`drizzle-kit`) are strictly forward-only and expand-contract. A rolled-back application will operate safely against the newer database schema.
