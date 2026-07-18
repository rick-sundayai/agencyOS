# Compliance Documentation Changelog

All notable changes to the AgencyOS compliance documentation suite are recorded here. This log serves as an audit trail for compliance reviews and version control.

---

## [1.0.0] — 2026-07-18

### Added
- **Initial compliance documentation suite** published and organized
- Six core compliance documents:
  - `01-policies/workstation-endpoint-security.md`
  - `01-policies/data-retention-deletion.md`
  - `02-architecture/system-architecture-trust-boundaries.md`
  - `03-operations/operator-runbook-provisioning-sdlc.md`
  - `03-operations/incident-response-monitoring.md`
  - `03-operations/disaster-recovery-backups.md`
- **README.md** — Master index and navigation guide
- **METADATA.yaml** — Version tracking and governance
- **CHANGELOG.md** — This file (audit trail)

### Compliance Coverage
- SOC 2 Type II (Security, Availability, Confidentiality)
- GDPR (Data processing, deletion, cross-border considerations)
- Data Protection (Encryption, access control, isolation)

### Status
- **Suite Version:** 1.0.0
- **Status:** Published
- **Owner:** Rick Love (System Administrator)
- **Next Review:** 2027-07-18

---

## How to Add Entries

When updating compliance documentation:

1. **Update METADATA.yaml**
   - Increment `suite_version` (or specific document version)
   - Update `last_updated` and `next_review` dates
   - Add change summary under the document entry

2. **Add entry to CHANGELOG.md** (this file)
   - Use format: `[VERSION] — YYYY-MM-DD`
   - Include: Added/Changed/Removed/Fixed sections
   - Note: Author, impact level (Minor/Major), and any approvals

### Example Entry

```markdown
## [1.1.0] — 2026-10-15

### Changed
- Updated incident response escalation procedures (id: runbook-incident-response-monitoring)
  - Added on-call rotation schedule
  - Extended SLA for client notification from 4 to 6 hours

### Author
Rick Love

### Approvals
- System Administrator ✓
- On-Call Lead ✓

### Impact
Minor (operational update, no policy change)
```

---

## Version Format

This project uses **Semantic Versioning** (MAJOR.MINOR.PATCH):

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes, policy overhauls, new compliance frameworks
- **MINOR** (1.0.0 → 1.1.0): New documents, new sections, added procedures
- **PATCH** (1.0.0 → 1.0.1): Bug fixes, clarifications, typo corrections

---

## Archive

Previous versions and archived documents can be found in the Git commit history:
```bash
git log --oneline -- compliance/
```

To view a specific past version:
```bash
git show <commit-hash>:compliance/METADATA.yaml
```

---

*Last updated: 2026-07-18 by Rick Love*
