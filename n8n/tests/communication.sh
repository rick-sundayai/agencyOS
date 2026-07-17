#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

STAMP=$(date +%s)

# --- happy path: outreach decision → email in Mailpit, message logged, decision executed ---
HAPPY=$($PSQL "insert into candidates (org_id, full_name, email)
  values ('$ORG_ID', 'Comms Happy $STAMP', 'happy-$STAMP@example.com') returning id")
D1=$(api_post /api/agent/decisions "{\"org_id\":\"$ORG_ID\",\"agent\":\"screening\",\"action_class\":\"comms.candidate_outreach\",
  \"reasoning\":{\"summary\":\"comms golden\",\"evidence\":[],\"model\":\"manual\",\"prompt_version\":\"v0\"},
  \"payload\":{\"channel\":\"email\",\"to\":\"happy-$STAMP@example.com\",\"subject\":\"Golden $STAMP\",\"body\":\"Hello from the golden path.\"},
  \"candidate_id\":\"$HAPPY\"}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).decision.id))")

# --- deny path: revoked consent must fail the decision, never send ---
DENIED=$($PSQL "insert into candidates (org_id, full_name, email)
  values ('$ORG_ID', 'Comms Denied $STAMP', 'denied-$STAMP@example.com') returning id")
$PSQL "insert into consents (org_id, candidate_id, channel, status) values ('$ORG_ID', '$DENIED', 'email', 'revoked')" > /dev/null
D2=$(api_post /api/agent/decisions "{\"org_id\":\"$ORG_ID\",\"agent\":\"screening\",\"action_class\":\"comms.candidate_outreach\",
  \"reasoning\":{\"summary\":\"comms denied golden\",\"evidence\":[],\"model\":\"manual\",\"prompt_version\":\"v0\"},
  \"payload\":{\"channel\":\"email\",\"to\":\"denied-$STAMP@example.com\",\"subject\":\"Should never send $STAMP\",\"body\":\"nope\"},
  \"candidate_id\":\"$DENIED\"}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).decision.id))")

# Fast-forward both undo windows (tier-2 default is 15 min).
$PSQL "update decisions set undo_expires_at = now() - interval '1 minute' where id in ('$D1','$D2')" > /dev/null

wait_for "happy decision executed" \
  "$PSQL \"select count(*) from decisions where id='$D1' and state='executed'\"" 1
wait_for "email landed in Mailpit" \
  "curl -s 'http://localhost:8025/api/v1/search?query=Golden%20$STAMP' | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).messages_count))\"" 1
wait_for "message logged and threaded to the decision" \
  "$PSQL \"select count(*) from messages where decision_id='$D1'\"" 1
wait_for "denied decision failed with compliance reason" \
  "$PSQL \"select count(*) from decisions where id='$D2' and state='failed' and error like 'compliance_denied:%'\"" 1

MAILED=$($PSQL "select count(*) from messages where decision_id='$D2'")
[ "$MAILED" = "0" ] && echo "OK: denied decision never sent" || { echo "FAIL: denied decision sent mail"; exit 1; }
