# Workstation & Endpoint Security Policy

**Date:** July 2026  
**Scope:** AgencyOS Operator Devices

## 1. Overview

Access to the AgencyOS production infrastructure (GCP Console, Identity-Aware Proxy, Terraform state) is highly restricted. Any device used to access these environments must adhere to strict baseline security standards.

## 2. Minimum Device Requirements

Any laptop or workstation utilized by an AgencyOS operator must enforce the following:

- **Full Disk Encryption:** Enabled by default (e.g., Apple FileVault or Windows BitLocker).
- **Screen Lock:** Devices must be configured to automatically lock the screen after a maximum of 5 minutes of inactivity. Biometric or strong password authentication is required to unlock.
- **OS Updates:** Operating systems and web browsers must be kept up to date with the latest security patches within 14 days of release.
- **No Shared Accounts:** The user account on the OS must be dedicated to the operator. No shared or "guest" profiles are permitted on devices with production access.

## 3. Credential & Access Management

- **MFA Required:** Multi-Factor Authentication (MFA) is strictly enforced on the Google Workspace account used to access the GCP Console and Identity-Aware Proxy. Hardware security keys (e.g., YubiKey) or Authenticator apps are required; SMS-based MFA is strongly discouraged.
- **No Long-Lived Keys:** Operators must not store long-lived GCP Service Account JSON keys on local disk. Access to execute Terraform or gcloud commands must utilize temporary, short-lived tokens generated via `gcloud auth login`.
