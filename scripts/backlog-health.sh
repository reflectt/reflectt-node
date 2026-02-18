#!/usr/bin/env bash
set -euo pipefail

# Backlog health wrapper (tracked): proxies to reflectt-node API endpoint.
# Usage: scripts/backlog-health.sh [base_url]

BASE_URL="${1:-${BACKLOG_HEALTH_URL:-http://127.0.0.1:4445}}"
ENDPOINT="${BASE_URL%/}/health/backlog"

if command -v jq >/dev/null 2>&1; then
  curl -fsS "$ENDPOINT" | jq '{summary, lanes: [.lanes[] | {lane, readyFloor, counts, compliance}]}'
else
  curl -fsS "$ENDPOINT"
fi
