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

**Pivot: `cloud-sql-proxy` from a laptop cannot reach staging's DB at all.**
First attempt at the above failed with `config error: instance does not have
IP of type "PUBLIC"`. Checked `infra/modules/stamp/main.tf`'s Cloud SQL
`ip_configuration`: `ipv4_enabled = false`, private-network only (PSA) — by
design, matches the "No public DB" compliance line already in
`docs/deployment.md`. The plan's assumed proxy-from-laptop flow was never
actually reachable; this would have blocked every future client onboarding
the same way, not just staging.

Asked Rick to choose between (a) extending the `migrate` image to also run
these ops scripts, executed via `gcloud run jobs execute` — reusing VPC
access + the `DATABASE_URL` secret the `migrate` job already has wired in, no
proxy needed at all — or (b) temporarily granting the SQL instance a public
IP scoped to his current IP. He picked (a), the reusable/permanent fix.

Implemented: extended the `migrate` Dockerfile stage to also `COPY
scripts/ops`, `scripts/agents`, `src/lib/agent-auth.ts`, `src/db/client.ts`,
`src/db/schema` (previously it only contained `scripts/migrate.ts`).
Verified locally — built the `migrate` target, confirmed both
`bootstrap-staging-operator.ts` and `create-agent-key.ts` import cleanly
inside the container (no missing-module errors) before pushing. Pushed the
new image to `.../agencyos/migrate:bootstrap`. The `migrate` Cloud Run Job is
now the reusable one-off ops-script runner for every future client, not just
a migration-only job — documented in a Dockerfile comment at the stage.

Confirmed the exact `gcloud logging read` filter for reading a job
execution's stdout (`resource.type="cloud_run_job" AND
resource.labels.job_name="migrate" AND resource.labels.location="us-central1"`)
against real prior migration-run logs before handing it to Rick.

**More real bugs hit and fixed live before this closed out:**

1. `gcloud run jobs execute --wait` failed outright with `INVALID_ARGUMENT:
   Unknown name "priorityTier" at 'overrides'` — the local `gcloud` CLI
   (549.0.1) was stale enough to send a field the enabled Cloud Run API
   didn't recognize. Fixed with `gcloud components update` (→ 577.0.0).
2. First attempt at pointing n8n's env at the new key used `gcloud run
   services update n8n --update-env-vars AGENCYOS_AGENT_API_KEY=...`, which
   failed: `Cannot update environment variable ... because it has already
   been set with a different type`. That var is wired as a Secret Manager
   `secret_key_ref`, not a plain literal — can't override it directly.
   **Wrong turn taken here**: initially assumed fixing this secret +
   redeploying n8n was *the* fix for the 401 on `/api/agent/decisions`. It
   wasn't — that route's auth is entirely DB-backed (`requireAgentKey` in
   `src/lib/agent-auth.ts`, hash lookup against the `agents` table), and
   never reads `AGENCYOS_AGENT_API_KEY`/`AGENT_API_KEY` at all. Updating the
   secret was still worth doing (n8n's *own* real workflow calls do need the
   correct key in that env var) but it didn't address the verification
   failure by itself.
3. The actual cause: `$N8N_KEY` in Rick's shell was 23 characters, not the
   expected 64-hex-char key from `create-agent-key.ts` — never correctly
   captured in the first place (manual copy-paste from terminal log output
   is error-prone). Fixed by switching to an automated capture: execute the
   job, then `gcloud logging read ... | grep -E '^[0-9a-f]{64}$'` to pull the
   exact key line straight into the shell variable, no manual transcription
   step at all.
4. A stale `gcloud`/terraform application-default credential (`invalid_grant
   "reauth related error (invalid_rapt)"`) broke the `terraform output
   -raw app_url` call mid-verification — same class of issue hit earlier in
   this deployment (see Task 1). Fixed with `gcloud auth login --update-adc`.

**Final verification, Task 6 definition-of-done — all real, all passing:**
```
login: 200
cockpit stream: 307
agent decisions: 200
```
n8n's live Cloud Run env now carries the correct, verified 64-char key
(re-added as a new `agent-api-key` secret version, new revision deployed).
Task 6 complete.

## 2026-07-24 — first real click-through testing surfaces three more bugs

With Tasks 5–6 done, Rick logged into the live app as the operator
(`rick@sundayaiwork.com`) and clicked around for the first time. Browser
policy blocked the agent from loading the app directly in its own preview
pane, and the agent does not enter account passwords into login forms under
any circumstance — so this was Rick driving the UI and reporting back what
broke, with the agent diagnosing from GCP/Cloud Run logs and source code.
All three findings below are real, permanent module/app bugs, not
staging-only issues — every future client stamp would have hit the same
three walls.

**1. "Source" (JobDiva import) returned `502` — `jobdiva_unavailable`.**
Root-caused before any fix was attempted: `jobdiva-client-id`/`username`/
`password` had zero Secret Manager versions in staging, and separately
`infra/stamps/staging/main.tf` (the template every future client stamp gets
copied from) never declared or passed these variables through to the module
at all — `docs/deployment.md` already told operators to drop JobDiva creds
in `secrets.auto.tfvars`, but they'd have silently gone nowhere. Fixed in
`71b4996` (wire the root-module variables through). Rick added his real
JobDiva credentials to a gitignored `secrets.auto.tfvars` and applied — plan
reviewed first (3 new secret versions, `n8n` env changes only), applied
clean (3 added, 3 changed).

Retested — same `502` again. Second, deeper cause: the `JOBDIVA_*` secrets
were only ever wired to **n8n's** container (which doesn't even use them for
anything yet) — the **`app`** Cloud Run service, where `/api/jobs/import`
actually runs and reads `process.env.JOBDIVA_CLIENT_ID` directly
(`src/services/jobdiva.ts`), had neither the env vars nor the Secret Manager
IAM grants. Fixed in `fee47fd` (env vars + `app_reads` IAM grants, filtered
by the existing `secret_has_value` pattern). Plan reviewed (3 new IAM
grants, `app` env changes, `n8n` cosmetic-only), applied clean (3 added, 2
changed). JobDiva import confirmed working after this.

**2. Sourcing ("Source" → run pipeline) failed: `Missing required env var:
N8N_WEBHOOK_URL`.** The `app` service never had this env var wired at all —
another gap the plan/docs never caught because nothing had exercised this
path against real infra before. But setting the URL alone would not have
been enough: `src/lib/n8n.ts`'s `fireSourcingWebhook` sent a plain,
unauthenticated `fetch()`, and n8n's Cloud Run service has **no public
invoker by design** — the module already carried the comment `# NOTE: no
allUsers invoker on n8n — IAM auth required by omission`, an existing
decision this call simply never honored. Fixed in two parts:
- `a25c447` (app code, TDD): sign the webhook request with a Google ID
  token scoped to n8n's URL, via `google-auth-library` (already a
  dependency — same pattern as `src/services/embed.ts`'s Vertex calls),
  gated on `K_SERVICE` (Cloud Run only; local/dev n8n has no such gate).
  5 new tests in `src/lib/n8n.test.ts`.
- `3b8108a` (infra): wire `N8N_WEBHOOK_URL` on `app` and grant
  `roles/run.invoker` to app's service account on n8n. Hit a genuine
  Terraform circular-dependency error along the way — n8n's existing
  `AGENCYOS_URL` env already reads `app.uri`, so having `app`'s new env read
  `n8n.uri` back would cycle. Resolved by constructing n8n's URL from the
  project-number format (`https://n8n-<project_number>.<region>.run.app`)
  instead of the live resource attribute — verified live first (`curl` →
  `403` from Cloud Run's IAM layer, not a DNS/routing failure) before
  committing to relying on it.

Both commits required a `git push origin main` (15 commits, explicit
go-ahead obtained first) so the code fix could reach staging through the
normal `deploy-staging` CI pipeline, not a manual image build — confirmed
via `gh run view 30087829837`, all steps green. Terraform plan for the
env-var + IAM-grant side reviewed (1 added, 3 changed, cosmetic-only on the
other two) and applied clean.

**3. Retested — now a clean `404` from n8n itself, not a `403` or missing-env
error.** This is not a bug: it means the request now correctly reaches n8n
(auth fix confirmed working) and n8n simply has **no workflows imported**.
Confirmed: `n8n/dist/*.json` (built via `node n8n/build.mjs` from
`n8n/workflows/src/*.workflow.mjs`) are gitignored build artifacts never
built for staging; the existing `n8n/apply.sh` importer only works against
a local `docker compose` n8n instance (`docker compose exec n8n n8n
import:workflow ...`), with no Cloud Run equivalent; and n8n has no
pre-seeded admin account (no `N8N_BASIC_AUTH_*` configured) — first visit
will prompt its own owner-account setup wizard. **Deliberately left
unfixed** — Rick called this a distinct, larger piece of work (populating a
brand-new n8n instance for the first time, not a bug fix) and ended testing
for the day.

- **Status:** app-side sourcing plumbing (JobDiva import, n8n auth/wiring)
  is fully correct and verified end-to-end on real infra. n8n workflow
  content (the actual sourcing/screening/etc. automations) is the next
  distinct piece of work, whenever picked back up. Task 7 (teardown) still
  not started — mandatory STOP gate, needs Rick's fresh explicit go-ahead.

<!-- Next entry: n8n workflow bring-up, or Task 7 teardown result. -->
