#!/usr/bin/env bash
# Build workflow JSON, import into the running n8n container, restart to (re)activate.
set -euo pipefail
cd "$(dirname "$0")/.."
node n8n/build.mjs
docker compose exec -T n8n n8n import:workflow --separate --input=/workflows
# n8n (verified against 2.6.4) always deactivates workflows on import and requires an explicit
# publish per workflow id before a restart will pick it up as active again.
for f in n8n/dist/*.json; do
  wf_id="$(basename "$f" .json)"
  docker compose exec -T n8n n8n publish:workflow --id="$wf_id"
done
docker compose restart n8n
echo "waiting for n8n..."
for i in $(seq 1 30); do
  curl -sf -o /dev/null http://localhost:5678/healthz && { echo "n8n up"; exit 0; }
  sleep 2
done
echo "n8n did not come back" >&2; exit 1
