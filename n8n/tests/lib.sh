#!/usr/bin/env bash
# Shared helpers for n8n golden-path tests. Source from each test script.
API=http://localhost:3000
KEY=dev-agent-key-change-me
PSQL="docker compose exec -T db psql -U agency -tA -c"

api_get()  { curl -s -H "x-agent-api-key: $KEY" "$API$1"; }
api_post() { curl -s -X POST -H "x-agent-api-key: $KEY" -H 'content-type: application/json' -d "$2" "$API$1"; }

# wait_for <description> <command producing a number> <minimum>
wait_for() {
  local desc="$1" cmd="$2" want="$3" got=0
  for _ in $(seq 1 45); do
    got=$(eval "$cmd" 2>/dev/null || echo 0)
    if [ "${got:-0}" -ge "$want" ] 2>/dev/null; then echo "OK: $desc ($got)"; return 0; fi
    sleep 2
  done
  echo "TIMEOUT: $desc (last=$got)"; return 1
}

ORG_ID=$($PSQL "select id from orgs where name = 'Sunday AI Work'")
export ORG_ID
