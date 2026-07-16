#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

TYPE="totally.unknown.$(date +%s)"
curl -s -X POST http://localhost:5678/webhook/signal -H 'content-type: application/json' \
  -d "{\"org_id\":\"$ORG_ID\",\"type\":\"$TYPE\",\"payload\":{\"noise\":true}}"
echo

wait_for "risk card raised for unknown signal" \
  "$PSQL \"select count(*) from decisions where action_class='risk.alert' and reasoning->>'summary' = 'Unrecognized signal type: $TYPE'\"" 1
