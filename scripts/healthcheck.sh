#!/usr/bin/env bash
set -euo pipefail

# reflectt-node healthcheck — runnable green/red signal.
#
# Usage:
#   scripts/healthcheck.sh [base_url] [--json] [--quiet] [--timeout <seconds>] [--stdin]
#
# Notes:
#   --stdin reads a /health JSON payload from stdin (useful for tests).
#
# Examples:
#   scripts/healthcheck.sh
#   scripts/healthcheck.sh http://127.0.0.1:4445
#   scripts/healthcheck.sh --json
#
# Exit codes:
#   0 = healthy
#   1 = unhealthy / unreachable

BASE_URL_DEFAULT="${REFLECTT_NODE_URL:-${HEALTHCHECK_URL:-http://127.0.0.1:4445}}"
BASE_URL="$BASE_URL_DEFAULT"
MODE="text"   # text|json
QUIET=0
TIMEOUT_SECONDS="5"
STDIN_MODE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      MODE="json"
      shift
      ;;
    --quiet|-q)
      QUIET=1
      shift
      ;;
    --timeout)
      TIMEOUT_SECONDS="${2:-5}"
      shift 2
      ;;
    --stdin)
      STDIN_MODE=1
      shift
      ;;
    -h|--help)
      sed -n '1,120p' "$0"
      exit 0
      ;;
    *)
      BASE_URL="$1"
      shift
      ;;
  esac
done

BASE_URL="${BASE_URL%/}"

json_get() {
  local key="$1"
  if command -v python3 >/dev/null 2>&1; then
    KEY="$key" python3 -c $'import os, json, sys\n\nkey=os.environ.get("KEY", "")\nraw=sys.stdin.read()\nobj=json.loads(raw) if raw.strip() else {}\nval=obj\nfor part in key.split(".") if key else []:\n  if isinstance(val, dict) and part in val:\n    val=val[part]\n  else:\n    val=None\n    break\n\nif val is None:\n  print("")\nelif isinstance(val, (dict, list)):\n  print(json.dumps(val))\nelse:\n  print(val)'
    return 0
  fi

  if command -v jq >/dev/null 2>&1; then
    jq -r ".${key} // \"\""
    return 0
  fi

  # last-resort (non-robust) fallback
  grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"status"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/'
}

json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//"/\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  printf '%s' "$s"
}

fail() {
  local msg="$1"
  if [[ "$MODE" == "json" ]]; then
    printf '{"ok":false,"base_url":"%s","error":"%s"}\n' "$(json_escape "$BASE_URL")" "$(json_escape "$msg")"
  else
    if [[ "$QUIET" -ne 1 ]]; then
      echo "FAIL: ${msg}"
    fi
  fi
  exit 1
}

HEALTH_JSON=""
if [[ "$STDIN_MODE" -eq 1 ]]; then
  HEALTH_JSON=$(cat)
else
  if ! HEALTH_JSON=$(curl -fsS --max-time "$TIMEOUT_SECONDS" "${BASE_URL}/health" 2>/dev/null); then
    fail "unable to reach ${BASE_URL}/health"
  fi
fi

STATUS=$(printf '%s' "$HEALTH_JSON" | json_get "status" | tr -d '\r\n')
if [[ "$STATUS" != "ok" ]]; then
  if [[ -z "$STATUS" ]]; then
    fail "${BASE_URL}/health returned unexpected payload (missing status)"
  fi
  fail "${BASE_URL}/health status=${STATUS}"
fi

TASK_TOTAL=$(printf '%s' "$HEALTH_JSON" | json_get "tasks.total" | tr -d '\r\n')
TASK_BY_STATUS=$(printf '%s' "$HEALTH_JSON" | json_get "tasks.byStatus" | tr -d '\r\n')
CHAT_STATS=$(printf '%s' "$HEALTH_JSON" | json_get "chat" | tr -d '\r\n')
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || true)

if [[ "$MODE" == "json" ]]; then
  # keep payload compact but provable
  TASK_TOTAL_NUM="${TASK_TOTAL:-0}"
  if [[ -z "$TASK_TOTAL_NUM" ]]; then TASK_TOTAL_NUM="0"; fi

  TS_ESC="$(json_escape "${TS:-}")"
  BASE_ESC="$(json_escape "$BASE_URL")"

  # TASK_BY_STATUS / CHAT_STATS are expected to already be JSON (or empty)
  if [[ -z "$TASK_BY_STATUS" ]]; then TASK_BY_STATUS="null"; fi
  if [[ -z "$CHAT_STATS" ]]; then CHAT_STATS="null"; fi

  printf '{"ok":true,"base_url":"%s","status":"ok","timestamp":"%s","tasks_total":%s,"tasks_by_status":%s,"chat":%s}\n' \
    "$BASE_ESC" "$TS_ESC" "$TASK_TOTAL_NUM" "$TASK_BY_STATUS" "$CHAT_STATS"
  exit 0
fi

if [[ "$QUIET" -ne 1 ]]; then
  echo "OK: reflectt-node healthy (${BASE_URL})"
  if [[ -n "$TASK_TOTAL" ]]; then
    echo "  tasks.total: ${TASK_TOTAL}"
  fi
fi

exit 0
