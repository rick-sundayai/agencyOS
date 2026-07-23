# Deployment log

Permanent, append-only record of real deployment events against real GCP
projects — what was run, what broke, what was decided, and why. Distinct from
`.superpowers/sdd/progress.md` (a per-plan execution ledger that gets
archived when its plan finishes): this file persists across plans and is the
place to look for "why is the infra shaped this way" months from now.

Append a new dated entry each time a deployment milestone lands — a stamp
applies cleanly, a teardown completes, a bug is found in prod-like conditions,
a client onboards. Newest entry at the bottom.

---

## 2026-07-2x — `ops` project stood up (Task 1)

- Ops project ID is **`agencyos-ops-f2f92e`**, not the plan-assumed
  `agencyos-ops` — that ID and a second candidate (`agencyosv1`, an old
  unrelated test project) were both abandoned. Every command/doc must resolve
  the ops project dynamically (`terraform -chdir=infra/ops output -raw ...`),
  never hardcode `agencyos-ops`.
- GCS backend bucket: `agencyos-ops-f2f92e-tfstate`. Registry:
  `us-central1-docker.pkg.dev/agencyos-ops-f2f92e/agencyos`.
- Hit a billing-account project-count quota on first apply; resolved by
  unlinking billing from the abandoned `agencyosv1` project.
- **Known unresolved issue:** `infra/ops/terraform.tfvars`'s `billing_account`
  points to a different (newer) billing account than the one
  `agencyos-ops-f2f92e` is actually billed under. `infra/stamps/staging/terraform.tfvars`
  has the correct (original) account. Not fixed — flagged to Rick, needs a
  decision.

## 2026-07-2x — module hardening (Task 2) + docs (Task 3)

- Added `sql_deletion_protection` variable to `infra/modules/stamp` (default
  `true`; staging overrides to `false`) so staging can be torn down and
  reapplied repeatedly without hand-editing the module each cycle.
- Documented the pre-production full-fleet-nuke gate and the `:bootstrap`
  image build step in `docs/deployment.md`.

## 2026-07-2x — bootstrap images built (Task 4)

- Built and pushed `app:bootstrap` / `migrate:bootstrap` to the ops registry.
  First real evidence of the arm64/amd64 issue below (images initially built
  arm64-only on Apple Silicon; not caught until Task 5's Cloud Run deploy).

## 2026-07-23 — first real `staging` apply + deploy (Task 5)

`terraform apply` in `infra/stamps/staging` succeeded after an iterative
debug loop. Every fix below is a **permanent change to the shared
`infra/modules/stamp` module** (affects every future client stamp, not a
staging-only hack) — committed together as a single deferred commit after
being applied live (see "commit hygiene" note at the end of this entry):

| Bug | Fix |
|---|---|
| Cloud SQL `Edition` defaults to `ENTERPRISE_PLUS`, incompatible with `db-g1-small` tier | Pinned `edition = "ENTERPRISE"` on the SQL instance |
| Secret Manager rejects empty-string payloads (JobDiva secrets have no value yet) | Added `secret_has_value` local (`nonsensitive(v != "")` — a sensitive-derived bool can't be used raw in `for_each`) and filtered both the secret *versions* and n8n's env-var references to them |
| Cross-project Artifact Registry pulls need an explicit grant | Added `google_artifact_registry_repository_iam_member.stamp_pulls_images`, granting the stamp's own Cloud Run Service Agent (`service-<PROJECT_NUMBER>@serverless-robot-prod.iam.gserviceaccount.com`) `roles/artifactregistry.reader` on the ops registry |
| `deletion_protection` blocked replacing already-tainted Cloud Run resources | Set `deletion_protection = false` on both Cloud Run services + the migrate job; had to `terraform untaint` manually first since Terraform's destroy-time check reads *live* state, not new config |
| Org's Domain Restricted Sharing policy blocked the app's public `allUsers` invoker binding | Asked Rick explicitly (didn't decide unilaterally) — he chose a **project-level exception** over an org-wide policy change. Added `google_org_policy_policy.allow_public_invoker`, scoped to the stamp's own project |
| n8n's image (`docker.n8n.io/n8nio/n8n:1.99.1`) isn't a registry Cloud Run can pull from | Asked Rick again — he chose **mirroring into the existing AR repo** over other options. `n8n_image` is now a required variable (no hardcoded default) on both the module and every stamp |
| Apple Silicon `docker build` defaults to arm64; Cloud Run needs amd64 | Rebuilt both bootstrap images with `--platform linux/amd64`; fixed the documented build commands in `docs/deployment.md` permanently |

Result: `app_url` = `https://app-uke3d6peea-uc.a.run.app`. Triggered
`gh workflow run deploy-staging` (run `30015758829`) — migrations ran, app
deployed, smoke test passed:
```
ok   login page renders (200, html)
ok   agent API is up and key-guarded (401/403 without key)
ok   cockpit stream endpoint does not 5xx
```

**Commit hygiene note:** these fixes were applied live to unblock the apply,
then committed to git afterward rather than before — acceptable this once
since it was a first-time bring-up under active debugging, but going forward
each fix should be committed as soon as it's confirmed working, not batched
at the end of a long session.

## 2026-07-23 — operator + n8n agent key provisioning (Task 6, in progress)

- Added `scripts/ops/bootstrap-staging-operator.ts` (+ test, TDD) — generates
  a random bcrypt-hashed operator password and inserts the `rick@sundayaiwork.com`
  admin user. This script is hardcoded to the internal ops org/account; it is
  **not** a generic per-client onboarding script (see `docs/deployment.md`
  "First user" for the pattern to copy/adapt per client).
- Live steps (connecting via `cloud-sql-proxy`, running the bootstrap script,
  provisioning n8n's real key via `scripts/agents/create-agent-key.ts`,
  pointing n8n's Cloud Run env at it, verifying with curl) were handed to
  Rick to run in his own terminal rather than run by the agent — both the
  operator password and the n8n key are real plaintext secrets meant to be
  captured once and never repeated; they shouldn't pass through agent
  context on purpose the way a one-off diagnostic command might.
- Also discovered: `docs/deployment.md`'s onboarding runbook had no step at
  all for provisioning n8n's per-client agent key, and its "First user"
  section had no concrete command sequence. Both fixed as part of this entry
  (see `docs/deployment.md` diff same day).
- **Status: waiting on Rick** to report back the three verification status
  codes (agent-key-authenticated `/api/agent/decisions`, `/login`,
  `/api/cockpit/stream`) as this task's definition-of-done evidence.

<!-- Next entry: Task 6 completion evidence, then Task 7 teardown result. -->
