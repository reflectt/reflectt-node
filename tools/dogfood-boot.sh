#!/usr/bin/env bash
# dogfood-boot.sh — One-command reproducible local+CI boot for reflectt-node
# Verifies: build → start → health → tasks → chat → inbox → presence → dashboard endpoints
# Usage: PORT=4447 ./tools/dogfood-boot.sh   (default PORT=4447 to avoid conflict with running instance)
#
# Exit codes: 0 = all checks pass, 1 = one or more checks failed

set -uo pipefail

PORT="${PORT:-4447}"
BASE="http://127.0.0.1:${PORT}"
DATA_DIR=$(mktemp -d)
PID=""
PASS=0
FAIL=0
TOTAL=0

cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

log()  { echo "  $1"; }
pass() { TOTAL=$((TOTAL + 1)); PASS=$((PASS + 1)); log "✅ $1"; }
fail() { TOTAL=$((TOTAL + 1)); FAIL=$((FAIL + 1)); log "❌ $1"; }

check_status() {
  local name="$1" url="$2" expected_status="${3:-200}"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")
  if [ "$status" = "$expected_status" ]; then
    pass "$name (HTTP $status)"
  else
    fail "$name (expected $expected_status, got $status)"
  fi
}

check_json_field() {
  local name="$1" url="$2" field="$3"
  local body
  body=$(curl -s --max-time 5 "$url" 2>/dev/null || echo "")
  if echo "$body" | grep -q "\"$field\""; then
    pass "$name"
  else
    fail "$name (missing field: $field)"
  fi
}

echo ""
echo "🔧 reflectt-node dogfood boot"
echo "   Port: $PORT | Data: $DATA_DIR"
echo ""

# ── Step 1: Clean build ──────────────────────────────────────────────
echo "── Build ──"
cd "$(dirname "$0")/.."

if npm run build > "$DATA_DIR/build.log" 2>&1; then
  pass "TypeScript build (tsc)"
else
  fail "TypeScript build (tsc)"
  echo "   Build log: $DATA_DIR/build.log"
  echo ""
  echo "RESULT: 0/$((TOTAL)) passed — build failed, cannot continue"
  exit 1
fi

# Verify dist output exists and is fresh
if [ -f dist/index.js ]; then
  # Check dist is newer than ALL src files (not just server.ts)
  STALE=$(find src -name '*.ts' -newer dist/index.js 2>/dev/null | head -1)
  if [ -n "$STALE" ]; then
    fail "Build freshness (stale: $STALE newer than dist/index.js)"
  else
    pass "Build freshness (dist up to date)"
  fi
else
  fail "Build output (dist/index.js missing)"
  echo ""
  echo "RESULT: $PASS/$TOTAL passed — no dist output"
  exit 1
fi

# ── Step 2: Start server ─────────────────────────────────────────────
echo ""
echo "── Server start ──"

REFLECTT_HOME="$DATA_DIR" \
  PORT="$PORT" \
  IDLE_NUDGE_ENABLED=false \
  CADENCE_WATCHDOG_ENABLED=false \
  MENTION_RESCUE_ENABLED=false \
  node dist/index.js > "$DATA_DIR/server.log" 2>&1 &
PID=$!

# Wait for server to be ready (up to 10s)
READY=false
for i in $(seq 1 20); do
  if curl -s -o /dev/null --max-time 1 "$BASE/health" 2>/dev/null; then
    READY=true
    break
  fi
  sleep 0.5
done

if $READY; then
  pass "Server started (PID $PID)"
else
  fail "Server start (timeout after 10s)"
  cat "$DATA_DIR/server.log" | tail -20
  echo ""
  echo "RESULT: $PASS/$TOTAL passed — server failed to start"
  exit 1
fi

# ── Step 3: E2E endpoint checks ──────────────────────────────────────
echo ""
echo "── Endpoint checks ──"

# Health
check_json_field "GET /health" "$BASE/health" "timestamp"

# Tasks CRUD
TASK_BODY='{"title":"Dogfood boot: verify task lifecycle","createdBy":"dogfood","assignee":"link","reviewer":"kai","done_criteria":["Task is created and retrievable via API","Task appears in task list"],"eta":"1h","priority":"P3"}'
TASK_RESP=$(curl -s -X POST "$BASE/tasks" -H "Content-Type: application/json" -d "$TASK_BODY" --max-time 5 2>/dev/null || echo "")
TASK_ID=$(echo "$TASK_RESP" | grep -o '"id":"task-[^"]*"' | head -1 | cut -d'"' -f4 || true)

if [ -n "$TASK_ID" ]; then
  pass "POST /tasks (created $TASK_ID)"
else
  fail "POST /tasks (no task ID returned)"
  TASK_ID=""
fi

if [ -n "$TASK_ID" ]; then
  check_status "GET /tasks/$TASK_ID" "$BASE/tasks/$TASK_ID"
fi

check_status "GET /tasks (list)" "$BASE/tasks"

# Chat
CHAT_BODY='{"from":"dogfood","content":"Dogfood boot test message","channel":"general"}'
CHAT_RESP=$(curl -s -X POST "$BASE/chat/messages" -H "Content-Type: application/json" -d "$CHAT_BODY" --max-time 5 2>/dev/null || echo "")
if echo "$CHAT_RESP" | grep -q '"success":true'; then
  pass "POST /chat/messages"
else
  fail "POST /chat/messages"
fi

check_status "GET /chat/messages" "$BASE/chat/messages"

# Inbox
check_status "GET /inbox/link" "$BASE/inbox/link"

# Presence
PRES_BODY='{"status":"working"}'
PRES_RESP=$(curl -s -X POST "$BASE/presence/dogfood" -H "Content-Type: application/json" -d "$PRES_BODY" --max-time 5 2>/dev/null || echo "")
if echo "$PRES_RESP" | grep -q '"success":true\|"status"'; then
  pass "POST /presence/dogfood"
else
  fail "POST /presence/dogfood"
fi

# Health agents (dashboard data)
check_status "GET /health/agents" "$BASE/health/agents"

# Docs (serves API reference)
check_status "GET /docs" "$BASE/docs"

# ── Results ───────────────────────────────────────────────────────────
echo ""
echo "── Result ──"
echo "   $PASS/$TOTAL passed, $FAIL failed"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo "🟢 All checks passed"
  exit 0
else
  echo "🔴 $FAIL check(s) failed"
  exit 1
fi
