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
