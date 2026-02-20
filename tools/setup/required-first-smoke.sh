#!/usr/bin/env bash
set -euo pipefail

CHANNEL="task-comments"
MENTION="@link"
API_BASE="http://127.0.0.1:4445"
TIMEOUT_SECONDS=90

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel)
      CHANNEL="$2"
      shift 2
      ;;
    --mention)
      MENTION="$2"
      shift 2
      ;;
    --api-base)
      API_BASE="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    *)
      echo "Unknown arg: $1"
      exit 1
      ;;
  esac
done

state_fail() {
  local ref="$1"
  local next_cmd="$2"
  echo "❌ ${ref}"
  echo "next: ${next_cmd}"
  exit 1
}

state_pass() {
  local ref="$1"
  echo "✅ ${ref}"
}

TOKEN="smoke-$(date +%s)"
PAYLOAD="${MENTION} first-run smoke ${TOKEN}"
# outbound send
resp=$(curl -s -X POST "${API_BASE}/chat/messages" \
  -H 'Content-Type: application/json' \
  -d "{\"author\":\"first-run-smoke\",\"channel\":\"${CHANNEL}\",\"content\":\"${PAYLOAD}\"}")

if ! echo "$resp" | grep -q "${TOKEN}"; then
  state_fail "R7_SMOKE_SEND_FAILED" "curl -s ${API_BASE}/health"
fi

state_pass "R7_SMOKE_SENT"

# wait for response containing token from non-smoke author
end=$(( $(date +%s) + TIMEOUT_SECONDS ))
while [[ $(date +%s) -lt $end ]]; do
  msgs=$(curl -s "${API_BASE}/chat/messages?channel=${CHANNEL}&limit=200")

  found=$(MSGS="$msgs" TOKEN="$TOKEN" python3 - <<'PY'
import json,os
raw=os.environ.get("MSGS", "")
token=os.environ.get("TOKEN", "")
try:
    data=json.loads(raw)
except Exception:
    print("0")
    raise SystemExit(0)
messages=data.get("messages") if isinstance(data, dict) else []
if not isinstance(messages, list):
    print("0")
    raise SystemExit(0)
outbound=False
reply=False
for m in messages:
    if not isinstance(m, dict):
        continue
    content=str(m.get("content",""))
    author=str(m.get("author",""))
    if token in content and author=="first-run-smoke":
        outbound=True
    if token in content and author!="first-run-smoke":
        reply=True
print("1" if outbound and reply else "0")
PY
)

  if [[ "$found" == "1" ]]; then
    state_pass "R7_SMOKE_PASS"
    exit 0
  fi

  sleep 2
done

state_fail "R7_SMOKE_PASS" "curl -s ${API_BASE}/chat/messages?channel=${CHANNEL}&limit=50"
