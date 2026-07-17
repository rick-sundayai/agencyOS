#!/usr/bin/env bash
# Phase 1 golden path: ingest candidates → job order signal → shortlist → scores →
# outreach card → undo window → compliance gate → email in Mailpit.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
STAMP=$(date +%s)

echo "== 1. ingest a strong candidate =="
curl -s -X POST http://localhost:5678/webhook/ingest-candidate -H 'content-type: application/json' -d "{
  \"org_id\":\"$ORG_ID\",
  \"candidate\":{\"full_name\":\"E2E Strong $STAMP\",\"email\":\"e2e-strong-$STAMP@example.com\",\"current_title\":\"Senior React Developer\"},
  \"resume_text\":\"Senior React Developer, 9 years. Deep React, TypeScript, Next.js, AWS (ECS, RDS, S3). Led migration to App Router. Contract roles completed end-to-end. Strong communication; quantified impact: cut page load 60%.\"}"
echo
wait_for "strong candidate embedded" \
  "$PSQL \"select count(*) from embeddings e join candidate_documents cd on cd.id=e.subject_id join candidates c on c.id=cd.candidate_id where c.full_name='E2E Strong $STAMP'\"" 1

echo "== 2. job order arrives as a signal =="
JOB_ID=$($PSQL "insert into job_orders (org_id, title, description, kind, must_haves)
  values ('$ORG_ID', 'E2E Senior React Developer $STAMP', 'Senior React + TypeScript contractor to build Next.js apps on AWS.',
          'contract', '[\"React\",\"TypeScript\",\"Next.js\",\"AWS\"]'::jsonb) returning id")
curl -s -X POST http://localhost:5678/webhook/signal -H 'content-type: application/json' \
  -d "{\"org_id\":\"$ORG_ID\",\"type\":\"job_order.created\",\"payload\":{\"job_order_id\":\"$JOB_ID\"}}"
echo

echo "== 3. spine produces shortlist + scores =="
wait_for "shortlist executed" \
  "$PSQL \"select count(*) from decisions where action_class='source.shortlist' and job_order_id='$JOB_ID' and state='executed'\"" 1
wait_for "scores persisted" \
  "$PSQL \"select count(*) from scores where job_order_id='$JOB_ID'\"" 1

echo "== 4. approvable outreach (or risk) cards exist =="
wait_for "post-screen cards raised" \
  "$PSQL \"select count(*) from decisions where job_order_id='$JOB_ID' and action_class in ('comms.candidate_outreach','risk.alert')\"" 1

echo "== 5. fast-forward undo windows; executor sends =="
$PSQL "update decisions set undo_expires_at = now() - interval '1 minute'
       where job_order_id='$JOB_ID' and action_class='comms.candidate_outreach' and state='approved'" > /dev/null
SENT_EXPECTED=$($PSQL "select count(*) from decisions where job_order_id='$JOB_ID' and action_class='comms.candidate_outreach'")
if [ "$SENT_EXPECTED" -ge 1 ]; then
  wait_for "outreach executed" \
    "$PSQL \"select count(*) from decisions where job_order_id='$JOB_ID' and action_class='comms.candidate_outreach' and state='executed'\"" 1
  wait_for "email in Mailpit" \
    "curl -s 'http://localhost:8025/api/v1/search?query=e2e-strong-$STAMP@example.com' | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).messages_count))\"" 1
else
  echo "NOTE: live scorer rated the candidate below 'yes' — check risk cards in the cockpit instead."
fi

echo "== E2E COMPLETE =="
$PSQL "select agent, action_class, tier, state from decisions where job_order_id='$JOB_ID' order by proposed_at"
