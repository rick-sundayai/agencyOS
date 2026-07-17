#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

NAME="Steward Golden $(date +%s)"
BODY=$(cat <<JSON
{"org_id":"$ORG_ID",
 "candidate":{"full_name":"$NAME","email":"steward-$(date +%s)@example.com","current_title":"Senior React Developer"},
 "resume_text":"Senior React Developer with 9 years building TypeScript SPAs on AWS. Led a team of 5. Migrated a legacy monolith to Next.js. Strong testing culture with Vitest and Playwright."}
JSON
)
curl -s -X POST http://localhost:5678/webhook/ingest-candidate -H 'content-type: application/json' -d "$BODY"
echo

wait_for "candidate row created" \
  "$PSQL \"select count(*) from candidates where full_name = '$NAME'\"" 1
wait_for "steward decision executed" \
  "$PSQL \"select count(*) from decisions where agent='data-steward' and state='executed' and reasoning->>'summary' like 'Ingested candidate $NAME%'\"" 1
wait_for "embeddings written for the resume" \
  "$PSQL \"select count(*) from embeddings e join candidate_documents cd on cd.id = e.subject_id join candidates c on c.id = cd.candidate_id where c.full_name = '$NAME'\"" 1
