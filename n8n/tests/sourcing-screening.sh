#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

# Needs at least one embedded candidate — run data-steward.sh first if the pool is empty.
JOB_ID=$($PSQL "insert into job_orders (org_id, title, description, kind, must_haves)
  values ('$ORG_ID', 'Senior React Developer (golden)', 'Build and test React + TypeScript apps on AWS.',
          'contract', '[\"React\",\"TypeScript\",\"AWS\"]'::jsonb) returning id")
echo "job: $JOB_ID"

curl -s -X POST http://localhost:5678/webhook/signal -H 'content-type: application/json' \
  -d "{\"org_id\":\"$ORG_ID\",\"type\":\"job_order.created\",\"payload\":{\"job_order_id\":\"$JOB_ID\"}}"
echo

wait_for "shortlist decision executed" \
  "$PSQL \"select count(*) from decisions where action_class='source.shortlist' and job_order_id='$JOB_ID' and state='executed'\"" 1
wait_for "at least one score persisted" \
  "$PSQL \"select count(*) from scores where job_order_id='$JOB_ID'\"" 1
wait_for "screening decisions executed" \
  "$PSQL \"select count(*) from decisions where action_class='screen.score_resume' and job_order_id='$JOB_ID' and state='executed'\"" 1
echo "queue cards for this job (tier-2 outreach and/or risk):"
$PSQL "select action_class, tier, state from decisions where job_order_id='$JOB_ID' order by proposed_at"

# --- UI-triggered run: phase progression + JobDiva soft-fail ---------------------
# Create a run row like POST /api/jobs/:id/source does, then hit the webhook with it.
RUN_ID=$($PSQL "insert into sourcing_runs (org_id, job_order_id) values ('$ORG_ID', '$JOB_ID') returning id")
echo "sourcing run: $RUN_ID"

curl -s -X POST http://localhost:5678/webhook/source -H 'content-type: application/json' \
  -d "{\"org_id\":\"$ORG_ID\",\"job_order_id\":\"$JOB_ID\",\"sourcing_run_id\":\"$RUN_ID\"}"
echo

wait_for "sourcing run reaches a terminal phase" \
  "$PSQL \"select count(*) from sourcing_runs where id='$RUN_ID' and phase in ('done','failed')\"" 1
echo "run outcome:"
$PSQL "select phase, stats, coalesce(error,'') from sourcing_runs where id='$RUN_ID'"
# Without JobDiva creds the thin-check branch must soft-fail (jobdiva_error in stats)
# and still complete — 'done' with applications created proves the whole loop.
wait_for "sourced applications exist for the job" \
  "$PSQL \"select count(*) from applications where job_order_id='$JOB_ID'\"" 1
