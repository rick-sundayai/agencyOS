# GCP Staging POC Execution + Teardown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the already-approved, already-coded GCP stamp architecture on real infrastructure for the first time, prove it genuinely works end-to-end, and tear it down cleanly and repeatably between test cycles.

**Architecture:** No new architecture. Executes the existing Terraform in `infra/ops` and `infra/stamps/staging` against real GCP, with one small module addition (a deletion-protection escape hatch for repeatable teardown) and one small operational script (provisioning a real per-agent key, since the app's auth model changed after the Terraform was written).

**Tech Stack:** Terraform (Google provider ~6.0), gcloud CLI, Docker, GitHub CLI (`gh`), Cloud SQL Auth Proxy, tsx/Node scripts, vitest.

## Global Constraints

- Region for every resource in this pass: `us-central1` (existing default — not the EU/GDPR variant from the separately-evaluated generic guide).
- `org_id` and `billing_account` are never read, logged, or pasted into chat by the agent. They live only in operator-authored, gitignored `*.tfvars` files or `TF_VAR_*` shell exports the operator sets themselves.
- Any `terraform apply` / `terraform destroy` / `gcloud projects delete` touching real billed resources (the `ops` project or the `staging` stamp) is preceded by showing the operator the exact plan or command output and getting explicit go-ahead — never chained automatically.
- `ops` persists across test cycles. Only `staging` is destroyed and recreated per cycle. Destroying `ops` (the "full fleet nuke") is explicitly out of scope for this plan — it's a one-time, pre-production gate, documented but not executed here.
- No architecture changes to `infra/modules/stamp` beyond the one `sql_deletion_protection` variable in Task 2.
- `npm test` (vitest) stays green throughout.

---

### Task 1: Bootstrap the `ops` project on GCP

**Files:** none created or modified. Consumes existing `infra/ops/main.tf`, `infra/ops/variables.tf`, `infra/ops/outputs.tf` as-is.

**Interfaces:**
- Produces (for all later tasks): live GCP project `agencyos-ops`; Artifact Registry at `terraform output -raw artifact_registry` (`us-central1-docker.pkg.dev/agencyos-ops/agencyos`); GCS state bucket `agencyos-ops-tfstate`; GitHub repo variables `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_AR`, `GCP_REGION` on `rick-sundayai/agencyOS`.

- [ ] **Step 1 (OPERATOR, Rick): refresh gcloud credentials**

Run: `gcloud auth login`
Expected: browser OAuth flow completes; shell prints `You are now logged in as [rick@sundayaiwork.com]`.

- [ ] **Step 2 (OPERATOR, Rick): confirm billing account locally — do not share the ID in chat**

Run: `gcloud billing accounts list`
Note the `ACCOUNT_ID` column value for the account to use for this project.

- [ ] **Step 3 (OPERATOR, Rick): create the ops tfvars file (gitignored — the agent never reads this file)**

Create `infra/ops/terraform.tfvars`:
```hcl
org_id          = "<your GCP organization numeric ID>"
billing_account = "<the ACCOUNT_ID from Step 2>"
ops_project_id  = "agencyos-ops"
```
Verify it's ignored: `git check-ignore infra/ops/terraform.tfvars` — should print the path.

- [ ] **Step 4: init and plan**

Run: `cd infra/ops && terraform init`
Expected: `Terraform has been successfully initialized!`

Run: `terraform plan`
Expected: `Plan: 14 to add, 0 to change, 0 to destroy.` (1 project, 6 API enables, 1 GCS bucket, 1 Artifact Registry repo, 1 deployer SA, 1 WIF pool, 1 WIF provider, 1 WIF binding, 1 registry IAM grant.)

- [ ] **Step 5: STOP — operator review gate**

Show Rick the full `terraform plan` output above. This creates a real, billed GCP project. **Do not proceed to Step 6 until he explicitly confirms.**

- [ ] **Step 6 (after explicit go-ahead): apply**

Run: `terraform apply -auto-approve`
Expected: `Apply complete! Resources: 14 added, 0 changed, 0 destroyed.` followed by the 4 outputs (`artifact_registry`, `tfstate_bucket`, `wif_provider`, `deployer_sa`).

- [ ] **Step 7: migrate state to the GCS backend**

Edit `infra/ops/main.tf`: uncomment the `backend "gcs" { bucket = "agencyos-ops-tfstate" prefix = "ops" }` block (currently commented at lines 8-11).

Run: `terraform init -migrate-state`
When prompted `Do you want to copy existing state to the new backend?`, answer `yes`.
Expected: `Successfully configured the backend "gcs"!`

- [ ] **Step 8: set the 4 GitHub repo variables from ops outputs**

Run:
```bash
gh variable set GCP_WIF_PROVIDER --body "$(terraform output -raw wif_provider)"
gh variable set GCP_DEPLOY_SA --body "$(terraform output -raw deployer_sa)"
gh variable set GCP_AR --body "$(terraform output -raw artifact_registry)"
gh variable set GCP_REGION --body "us-central1"
```
Expected: each line prints `✓ Set variable GCP_XXX for rick-sundayai/agencyOS`.

- [ ] **Step 9: verify**

Run: `gh variable list`
Expected: all 4 variables listed with non-empty values.

- [ ] **Step 10: commit the backend-migration diff**

```bash
git add infra/ops/main.tf
git commit -m "infra: migrate ops state to GCS backend"
```
(`infra/ops/terraform.tfvars` stays untracked/gitignored — never committed.)

---

### Task 2: Add `sql_deletion_protection` variable to the stamp module

**Files:**
- Modify: `infra/modules/stamp/variables.tf`
- Modify: `infra/modules/stamp/main.tf:79`
- Modify: `infra/stamps/staging/main.tf` (module block)

**Interfaces:**
- Consumes: nothing from Task 1 except the already-migrated GCS backend (needed for Step 5's `terraform init` in `infra/stamps/staging`).
- Produces: `var.sql_deletion_protection` (bool, default `true`) on the `stamp` module, overridden to `false` only in the `staging` root module — this is what makes Task 7's teardown possible without hand-editing state.

- [ ] **Step 1: add the variable**

Add to `infra/modules/stamp/variables.tf` (after the `db_tier` variable block):
```hcl
variable "sql_deletion_protection" {
  type    = bool
  default = true
}
```

- [ ] **Step 2: wire it to the SQL instance**

In `infra/modules/stamp/main.tf`, change line 79 from:
```hcl
  deletion_protection = true
```
to:
```hcl
  deletion_protection = var.sql_deletion_protection
```

- [ ] **Step 3: validate the module in isolation**

Run: `cd infra/modules/stamp && terraform init -backend=false && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 4: override the default in staging only**

In `infra/stamps/staging/main.tf`, add one line to the `module "stamp"` block (real client stamps keep the default `true`):
```hcl
module "stamp" {
  source                   = "../../modules/stamp"
  stamp_name               = "staging"
  project_id               = "agencyos-staging"
  org_id                   = var.org_id
  billing_account          = var.billing_account
  deployer_sa              = var.deployer_sa
  alert_email              = var.alert_email
  app_image                = "${var.artifact_registry}/app:bootstrap"
  migrate_image             = "${var.artifact_registry}/migrate:bootstrap"
  sql_deletion_protection  = false
}
```

- [ ] **Step 5: validate staging**

Run: `cd infra/stamps/staging && terraform init && terraform validate`
Expected: `Success! The configuration is valid.` (`terraform init` succeeds because Task 1 already migrated the GCS backend this references.)

- [ ] **Step 6: sanity-check the plan is well-formed**

Run: `terraform plan`
Expected: plan succeeds with a `Plan: NN to add, 0 to change, 0 to destroy.` line (roughly 59 resources — the exact count isn't what matters here; what matters is it errors on nothing and shows 0 to destroy, since staging doesn't exist yet). **Do not apply here** — this is Task 5's job, after bootstrap images exist.

- [ ] **Step 7: commit**

```bash
git add infra/modules/stamp/variables.tf infra/modules/stamp/main.tf infra/stamps/staging/main.tf
git commit -m "infra: add sql_deletion_protection variable, disable for staging"
```

---

### Task 3: Document the bootstrap-image step and the pre-production gate

**Files:**
- Modify: `docs/deployment.md`

**Interfaces:** none — pure documentation, no code dependency on other tasks.

- [ ] **Step 1: add the pre-production gate note**

In `docs/deployment.md`, insert a new section immediately after line 4 (`Infra: infra/ (ops + stamp module). CI: .github/workflows/.`) and before `## Onboard a client`:

```markdown

## Before onboarding the first real client

Run a full fleet nuke once — destroy the `staging` stamp AND the `ops` project (Artifact
Registry, WIF, TF-state bucket, deployer SA), then rebuild `ops` from a clean bootstrap —
before the first real client stamp is created. This proves the whole fleet, including WIF
trust and GitHub repo variables, stands up from zero with nothing left over from testing.
See `docs/superpowers/specs/2026-07-22-gcp-staging-poc-execution-design.md` for the exact
commands. Not required again after the first real client exists.
```

- [ ] **Step 2: add the bootstrap-image callout**

Immediately under the existing `## Onboard a client` heading, before its numbered list, insert:

```markdown

> **First stamp ever (staging) only:** its Terraform hardcodes `:bootstrap`-tagged images
> because no real image exists yet. Build and push them once before the very first
> `terraform apply` (skip this for every client after staging exists):
> ```bash
> AR=$(terraform -chdir=infra/ops output -raw artifact_registry)
> docker build --target runtime -t "$AR/app:bootstrap" .
> docker build --target migrate -t "$AR/migrate:bootstrap" .
> docker push "$AR/app:bootstrap"
> docker push "$AR/migrate:bootstrap"
> ```
```

- [ ] **Step 3: commit**

```bash
git add docs/deployment.md
git commit -m "docs: bootstrap-image step and pre-production full-fleet-nuke gate"
```

---

### Task 4: Build and push the `:bootstrap` images

**Files:** none created or modified.

**Interfaces:**
- Consumes: `infra/ops` output `artifact_registry` (from Task 1).
- Produces: `$AR/app:bootstrap` and `$AR/migrate:bootstrap` images in Artifact Registry, consumed by Task 5's staging apply.

- [ ] **Step 1: authenticate Docker to Artifact Registry**

Run: `gcloud auth configure-docker us-central1-docker.pkg.dev --quiet`
Expected: `Docker configuration file updated.`

- [ ] **Step 2: resolve the registry path**

Run: `AR=$(terraform -chdir=infra/ops output -raw artifact_registry) && echo "$AR"`
Expected: prints `us-central1-docker.pkg.dev/agencyos-ops/agencyos`.

- [ ] **Step 3: build the runtime (app) image**

Run: `docker build --target runtime -t "$AR/app:bootstrap" .`
Expected: build completes, ends with `naming to $AR/app:bootstrap done` (or `Successfully tagged`), no error.

- [ ] **Step 4: build the migrate image**

Run: `docker build --target migrate -t "$AR/migrate:bootstrap" .`
Expected: build completes cleanly, same as Step 3.

- [ ] **Step 5: push both**

Run:
```bash
docker push "$AR/app:bootstrap"
docker push "$AR/migrate:bootstrap"
```
Expected: both print a final digest line with no error.

- [ ] **Step 6: verify**

Run: `gcloud artifacts docker images list "$AR" --include-tags`
Expected: output lists both `.../app` (tag `bootstrap`) and `.../migrate` (tag `bootstrap`).

---

### Task 5: Apply the staging stamp and run the first real deploy

**Files:** none created or modified (Task 2 already made `infra/stamps/staging/main.tf` correct).

**Interfaces:**
- Consumes: Task 1's ops outputs (`deployer_sa`, `artifact_registry`), Task 2's `sql_deletion_protection = false` wiring, Task 4's `:bootstrap` images.
- Produces: live `staging` Cloud Run app + n8n + Cloud SQL; `app_url` output, consumed by Task 6's verification.

- [ ] **Step 1 (OPERATOR, Rick): create the staging tfvars file (gitignored)**

Create `infra/stamps/staging/terraform.tfvars`:
```hcl
org_id          = "<same org id as infra/ops/terraform.tfvars>"
billing_account = "<same billing account as infra/ops/terraform.tfvars>"
alert_email     = "rick@sundayaiwork.com"
```
Verify: `git check-ignore infra/stamps/staging/terraform.tfvars` — should print the path.

- [ ] **Step 2: resolve the non-secret ops outputs as Terraform variables**

Run:
```bash
export TF_VAR_deployer_sa=$(terraform -chdir=infra/ops output -raw deployer_sa)
export TF_VAR_artifact_registry=$(terraform -chdir=infra/ops output -raw artifact_registry)
```
(These aren't secret — safe for the agent to read and set.)

- [ ] **Step 3: init and plan**

Run: `cd infra/stamps/staging && terraform init`
Expected: `Terraform has been successfully initialized!`

Run: `terraform plan`
Expected: a full "resources to add" plan (~59 resources), `0 to change, 0 to destroy`, no errors, referencing `.../app:bootstrap` and `.../migrate:bootstrap` as the container images.

- [ ] **Step 4: STOP — operator review gate**

Show Rick the full plan output. This creates real, billed Cloud Run + Cloud SQL resources (~$30-60/mo while it exists). **Do not proceed until he explicitly confirms.**

- [ ] **Step 5 (after explicit go-ahead): apply**

Run: `terraform apply -auto-approve`
Expected: `Apply complete! Resources: ~59 added, 0 changed, 0 destroyed.` followed by the `app_url` output.

- [ ] **Step 6: trigger and watch the first real deploy**

Run: `gh workflow run deploy-staging`
Run: `gh run watch --exit-status`
Expected: the run completes with exit code 0. Its log shows the `Smoke test` step printing `ok   login page renders (200, html)`, `ok   agent API is up and key-guarded (401/403 without key)`, `ok   cockpit stream endpoint does not 5xx` — all three `ok`, no `FAIL`.

---

### Task 6: Provision the operator + n8n's real agent key, verify end-to-end

**Files:**
- Create: `scripts/ops/bootstrap-staging-operator.ts`
- Test: `scripts/ops/bootstrap-staging-operator.test.ts`

**Interfaces:**
- Consumes: Task 5's live staging app + DB; the existing `scripts/agents/create-agent-key.ts` (`generateAgentKey`, unmodified, reused as-is) and `src/lib/agent-auth.ts` (`hashApiKey`, unmodified).
- Produces: a real `orgs`/`users` row for the operator, a real `agents` row for n8n with a matching Cloud Run env var, and the evidence required by the spec's definition of done.

- [ ] **Step 1: write the failing test**

Create `scripts/ops/bootstrap-staging-operator.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { generateOperatorPassword } from './bootstrap-staging-operator';

describe('generateOperatorPassword', () => {
  it('produces a plaintext password and a bcrypt hash that verifies it', () => {
    const { plaintext, hash } = generateOperatorPassword();
    expect(plaintext.length).toBeGreaterThan(10);
    expect(bcrypt.compareSync(plaintext, hash)).toBe(true);
  });

  it('is non-deterministic across calls', () => {
    const a = generateOperatorPassword();
    const b = generateOperatorPassword();
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});
```

- [ ] **Step 2: run it to verify it fails**

Run: `npx vitest run scripts/ops/bootstrap-staging-operator.test.ts`
Expected: FAIL — `Cannot find module './bootstrap-staging-operator'` (file doesn't exist yet).

- [ ] **Step 3: write the implementation**

Create `scripts/ops/bootstrap-staging-operator.ts`:
```typescript
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

export function generateOperatorPassword(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(18).toString('base64url');
  return { plaintext, hash: bcrypt.hashSync(plaintext, 10) };
}

if (process.argv[1]?.endsWith('bootstrap-staging-operator.ts')) {
  (async () => {
    const postgres = (await import('postgres')).default;
    const { getEnv } = await import('../../src/lib/env');

    const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });

    const [existingOrg] = await sql`select id from orgs where name = 'Sunday AI Work'`;
    const orgId = existingOrg?.id
      ?? (await sql`insert into orgs (name) values ('Sunday AI Work') returning id`)[0].id;

    const { plaintext, hash } = generateOperatorPassword();
    await sql`
      insert into users (org_id, email, full_name, role, password_hash)
      values (${orgId}, 'rick@sundayaiwork.com', 'Rick', 'admin', ${hash})
      on conflict (email) do update set password_hash = excluded.password_hash`;

    console.log('Operator password (copy now — it is not stored or shown again):');
    console.log(plaintext);
    await sql.end();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: run the test to verify it passes**

Run: `npx vitest run scripts/ops/bootstrap-staging-operator.test.ts`
Expected: PASS, 2/2 tests.

- [ ] **Step 5: commit**

```bash
git add scripts/ops/bootstrap-staging-operator.ts scripts/ops/bootstrap-staging-operator.test.ts
git commit -m "feat: add staging operator-bootstrap script"
```

- [ ] **Step 6: connect to staging via the Cloud SQL Auth Proxy**

Run (background):
```bash
cloud-sql-proxy agencyos-staging:us-central1:agencyos &
```
Expected: log line `Listening on 127.0.0.1:5432`.

- [ ] **Step 7: build a proxy-local DATABASE_URL from the real secret**

Run:
```bash
DB_SECRET=$(gcloud secrets versions access latest --secret=database-url --project=agencyos-staging)
DB_PASS=$(echo "$DB_SECRET" | sed -E 's#postgres://app:([^@]+)@.*#\1#')
export DATABASE_URL="postgres://app:${DB_PASS}@127.0.0.1:5432/agency"
```

- [ ] **Step 8: run the operator bootstrap against staging**

Run: `npx tsx scripts/ops/bootstrap-staging-operator.ts`
Expected: prints `Operator password (copy now — it is not stored or shown again):` followed by the plaintext. Save it somewhere durable (password manager) — it is not recoverable after this.

- [ ] **Step 9: provision n8n's real agent key**

Run: `npx tsx scripts/agents/create-agent-key.ts --name n8n --org "Sunday AI Work"`
Expected: prints `Agent "n8n" key (copy now — it is not stored or shown again):` followed by a 64-char hex plaintext. Capture it as `N8N_KEY`.

- [ ] **Step 10: point n8n's Cloud Run env at the real key**

Run:
```bash
gcloud run services update n8n --project agencyos-staging --region us-central1 \
  --update-env-vars AGENCYOS_AGENT_API_KEY="$N8N_KEY"
```
Expected: `Service [n8n] revision [...] has been deployed`.

- [ ] **Step 11: verify the agent-key ping actually succeeds (not just 401-without-key)**

Run:
```bash
APP_URL=$(terraform -chdir=infra/stamps/staging output -raw app_url)
curl -s -o /dev/null -w '%{http_code}\n' -H "x-agent-api-key: $N8N_KEY" "$APP_URL/api/agent/decisions"
```
Expected: `200` (not `401`) — proves a real per-agent key authenticates against the deployed app, closing the gap the stale Terraform secret left open.

- [ ] **Step 12: capture the remaining evidence for the spec's definition of done**

Run:
```bash
curl -s -o /dev/null -w 'login: %{http_code}\n' "$APP_URL/login"
curl -s -o /dev/null -w 'cockpit stream: %{http_code}\n' "$APP_URL/api/cockpit/stream"
```
Expected: `login: 200`; `cockpit stream:` any non-5xx code (302/307/401/403 are all fine — proves the route exists and doesn't crash). Show this output, the Step 11 `200`, and the Task 5 Step 6 smoke-test log to the operator together as the completed verification evidence.

---

### Task 7: Tear down the staging stamp and verify it's clean

**Files:** none created or modified.

**Interfaces:**
- Consumes: the live `staging` stamp from Task 5/6.
- Produces: nothing — this is the end of one test cycle. A subsequent cycle re-runs from Task 5's Step 3 (`ops` and the bootstrap images are untouched and don't need to be redone).

- [ ] **Step 1: STOP — operator review gate**

Confirm with Rick before destroying: this removes the live Cloud Run/Cloud SQL/n8n resources and, in Step 3, deletes the GCP project outright. **Do not proceed until he explicitly confirms.**

- [ ] **Step 2 (after explicit go-ahead): destroy everything Terraform can**

Run: `cd infra/stamps/staging && terraform destroy -auto-approve`
Expected: destroys Cloud Run (app + n8n), Cloud SQL (now deletable — Task 2's `sql_deletion_protection = false`), VPC, Secret Manager secrets, service accounts, monitoring. Ends with an error destroying `google_project.stamp` specifically — `Error: ... deletion_policy is set to "PREVENT"`. **This specific failure is expected and correct** — the project itself is deleted in Step 3, not by Terraform.

- [ ] **Step 3: delete the project directly**

Run: `gcloud projects delete agencyos-staging --quiet`
Expected: `Waiting for [operations/...] to finish...done.`

- [ ] **Step 4: verify the project is gone**

Run: `gcloud projects list --filter="projectId:agencyos-staging"`
Expected: no rows, or a row with `lifecycleState: DELETE_REQUESTED`.

- [ ] **Step 5: clean up the leftover state entry so the next cycle is a true fresh apply**

Run: `terraform state list`
Expected: only `google_project.stamp` remains (everything else was destroyed in Step 2).

Run: `terraform state rm google_project.stamp`
Expected: `Removed google_project.stamp` / `Successfully removed 1 resource instance(s).`

Run: `terraform state list`
Expected: empty output.

- [ ] **Step 6: confirm repeatability**

The next test cycle re-runs Task 5 Step 3 onward (`terraform init && terraform plan`) against the now-empty staging state — no changes needed to `ops` or the bootstrap images.

---

## Self-Review Notes

**Spec coverage:** execution sequence (Tasks 1, 4, 5, 6), teardown procedure (Task 7), `sql_deletion_protection` module change (Task 2), `:bootstrap` doc gap (Task 3 Step 2), pre-production full-fleet-nuke note (Task 3 Step 1), safety checkpoints (explicit STOP steps in Tasks 1, 5, 7), definition-of-done evidence (Task 6 Steps 11-12). The newly-discovered agent-key auth gap and its agreed fix (operational bootstrap, not a Terraform change) is Task 6.

**Placeholders:** none — every command, file path, and expected output above is concrete. The only operator-supplied unknowns (`org_id`, `billing_account`) are inherently real-world secrets the agent cannot know or invent, kept out of committed files and out of chat by design (Global Constraints).

**Type/name consistency:** `generateOperatorPassword` (Task 6) and `generateAgentKey` (existing, reused unmodified) are distinct, correctly-named functions — not aliases of each other. `sql_deletion_protection` is the exact variable name used consistently across Tasks 2, 5 (plan output), and 7 (why destroy succeeds).
