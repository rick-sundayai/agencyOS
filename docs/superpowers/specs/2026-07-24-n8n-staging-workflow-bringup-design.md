# n8n workflow bring-up for `agencyos-staging` — Design

**Date:** 2026-07-24
**Status:** Design approved by Rick, not yet implemented
**Approach:** Local `apply-remote.sh` over a `gcloud run services proxy` tunnel
(adapted from the already-designed AWS/ALB version), plus a permanent module fix
for a previously-undiscovered env-var mismatch.

## Goal

n8n's Cloud Run service in `agencyos-staging` is live but has no owner account and
zero workflows imported — confirmed in `docs/deployment-log.md`'s 2026-07-24 entry
(sourcing webhook correctly reaches n8n now, auth is fixed, but returns a clean
`404` because nothing is imported). Get all six workflows
(`n8n/workflows/src/*.workflow.mjs`) imported, active, and actually able to call
the app, then verify the full sourcing path end-to-end against real staging infra.

## Problem found during design (not previously known)

`n8n/workflows/src/helpers.js` reads `$env.AGENCY_API_URL` and `$env.AGENT_API_KEY`
for every Code node's calls back into the app — matching local
`docker-compose.yml`'s env names exactly. But
`infra/modules/stamp/main.tf`'s n8n `google_cloud_run_v2_service` wires the env as
`AGENCYOS_URL` / `AGENCYOS_AGENT_API_KEY` instead. Neither module-defined name is
read anywhere in the workflow code. `docs/deployment.md`'s "n8n editor access"
section (lines 109–113) documents the wrong names as fact, presumably written from
the module rather than the actual code. This has never been caught because no
n8n workflow has ever executed against staging before this session. Without
fixing it, importing and activating workflows would still leave every Code node
crashing on `API is undefined`.

## Decisions made

- **Fix goes in the shared module**, not a staging-only patch — consistent with
  every other fix this rollout (JobDiva wiring, n8n auth). Rename
  `AGENCYOS_URL` → `AGENCY_API_URL` and `AGENCYOS_AGENT_API_KEY` → `AGENT_API_KEY`
  in `infra/modules/stamp/main.tf`'s n8n service block. The underlying Secret
  Manager secret (`agent-api-key`) and its value are unchanged — only the env var
  *name* n8n sees changes. Rick applies via `terraform plan`/`apply` as usual (the
  agent doesn't run these directly).
- **No key rotation.** The `agent-api-key` secret already holds a verified-working
  value from Task 6 — reuse it. The n8n REST API key (`N8N_API_KEY`, used only by
  the new import script, see below) is inherently new since n8n has no owner
  account yet; nothing to decide there.
- **Import mechanism: local script over a `gcloud run services proxy` tunnel**,
  not an unattended Cloud-Run-Job-based importer. Simpler, no new infra (no new
  secret, no Dockerfile change), mirrors how the existing local `n8n/apply.sh`
  already works — re-run by hand whenever workflow source changes. Revisit if
  this ever needs to run unattended from CI.
- **Reuse the already-designed script**, don't redesign from scratch.
  `docs/superpowers/plans/2026-07-17-phase1d-migration-aws.md` (lines 1922–1960,
  written for a different target environment: AWS Fargate behind an ALB) already
  specs the exact create/update/activate-via-REST-API logic needed. Port it to
  `n8n/apply-remote.sh`, pointed at `http://localhost:5678` (the proxy tunnel)
  instead of an ALB DNS name. Because the tunnel carries Rick's own gcloud IAM
  identity, the script needs zero Cloud Run IAM code (no ID-token signing) —
  only n8n's own `X-N8N-API-KEY` header for its REST API.
- **Owner account + API key creation is manual, by Rick.** Passwords and API keys
  never pass through agent context, same rule applied to the operator password
  and n8n agent key in Task 6.

## Prerequisites from Rick

| # | Item | Status |
|---|---|---|
| 1 | `terraform apply` for the env-var rename (Fix 1) | To do, after plan review |
| 2 | Create n8n owner account via `gcloud run services proxy n8n --project agencyos-staging --region us-central1 --port 5678` → `http://localhost:5678` | To do |
| 3 | Generate n8n API key (Settings → API), export as `$N8N_API_KEY` locally | To do |

## Pass criteria

1. `infra/modules/stamp/main.tf` n8n env vars renamed, plan reviewed (env-var
   value/name changes only, no resource replacement expected), applied clean.
2. All six workflows (`agencyos-sourcing`, `agencyos-screening`,
   `agencyos-communication`, `agencyos-data-steward`, `agencyos-orchestrator`,
   `agencyos-heartbeat`) show `active: true` in n8n's UI after running
   `n8n/apply-remote.sh`.
3. `curl -X POST http://localhost:5678/webhook/ping -d '{}'` (through the tunnel)
   returns heartbeat's ack — proves import + activation actually took effect via
   the REST API path, isolated from the app.
4. Real path: Rick triggers "Source" on a job order in the live staging UI. The
   sourcing run's phase progresses (`queued → searching_pool → ... →
   shortlisting`, per `sourcing.workflow.mjs`) instead of failing — proving the
   env-var fix closed the `API is undefined` gap and the Code nodes can actually
   reach the app.

## Phases

### Phase 1 — Module fix
Rename the two env vars in `infra/modules/stamp/main.tf`. `terraform validate`
+ `fmt` (agent). Rick reviews plan output and applies.

### Phase 2 — n8n owner account + API key (Rick, manual)
Per prerequisites above. Agent does not participate — no password/key handling.

### Phase 3 — `n8n/apply-remote.sh`
New script, adapted from the AWS-plan version cited above:
- `node n8n/build.mjs` to produce `n8n/dist/*.json`.
- For each built workflow: look up by name via `GET /api/v1/workflows`, `PUT`
  (update) or `POST` (create) with `{name, nodes, connections, settings}`, then
  `POST /api/v1/workflows/:id/activate`.
- Usage: `N8N_REMOTE_URL=http://localhost:5678 N8N_API_KEY=<key> bash
  n8n/apply-remote.sh`, run by Rick (or the agent, since `N8N_API_KEY` is read
  from Rick's shell env, not typed by the agent) while the proxy tunnel is open
  in another terminal.

### Phase 4 — Verification
Run pass criteria 3–4 above. Diagnose any REST-API-shape surprises live (first
real run against this n8n version's public API) using
`superpowers:systematic-debugging`, same discipline as every other bug this
rollout.

### Phase 5 — Docs
- `docs/deployment.md`: fix "n8n editor access" section's wrong env var names;
  add the `apply-remote.sh` step to the onboarding runbook (currently has no
  workflow-import step at all — same class of gap Task 6 found for the agent-key
  step).
- `docs/deployment-log.md`: new dated entry once verified, following the
  established pattern (what broke, what was fixed, real verification evidence).

## Known risks

- n8n 2.6.4's public REST API shape (`/api/v1/workflows` create/update/activate)
  hasn't been verified live yet — the AWS-plan script's assumptions about response
  fields (e.g. `id` in the POST response) are unverified against this version.
  First real run through `apply-remote.sh` is the verification; expect to debug
  live if the shape differs.
- `gcloud run services proxy` behavior with n8n's webhook paths (`/webhook/<path>`
  for active workflows) is assumed to pass through unmodified — low risk, it's a
  plain reverse proxy, but not yet confirmed against this specific service.

## Out of scope

- Any change to workflow logic/content (screening, communication, data-steward,
  orchestrator remain as authored).
- Automating n8n owner-account creation — not possible, it's a password.
- Task 7 (teardown) — separate, has its own mandatory stop-gate.
- Rotating `agent-api-key` — explicitly decided against above.
