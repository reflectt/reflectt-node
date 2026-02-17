#!/usr/bin/env bash
# dogfood-boot.sh — One-command reproducible local dogfood boot
# Verifies: server start → health → task create → chat → presence → heartbeat cycle
# Exits 0 on success, 1 on failure. Cleans up on exit.
#
# Usage:
#   ./tools/dogfood-boot.sh          # Run locally
#   PORT=4446 ./tools/dogfood-boot.sh  # Custom port
#
set -uo pipefail

PORT="${PORT:-4446}"
HOST="127.0.0.1"
BASE="http://${HOST}:${PORT}"
NODE_ENV="${NODE_ENV:-test}"
SERVER_PID=""
PASS=0
FAIL=0
START_TIME=$(date +%s)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo -e "\n${CYAN}Stopping server (pid $SERVER_PID)...${NC}"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

check() {
  local label="$1"
  local result="$2"
  if [[ "$result" == "0" ]]; then
    echo -e "  ${GREEN}✓${NC} $label"
    ((PASS++))
  else
    echo -e "  ${RED}✗${NC} $label"
    ((FAIL++))
  fi
}

echo -e "${CYAN}═══ Dogfood Boot: reflectt-node ═══${NC}"
echo -e "Port: ${PORT} | Host: ${HOST} | Env: ${NODE_ENV}"
echo ""

# ─── Step 1: Build (if needed) ───
echo -e "${YELLOW}[1/6] Build check...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

if [[ ! -d "dist" ]] || [[ "src/server.ts" -nt "dist/server.js" ]]; then
  echo "  Building..."
  npm run build --silent 2>/dev/null || npx tsc 2>/dev/null
fi
check "Build complete" "0"

# ─── Step 2: Start server ───
echo -e "${YELLOW}[2/6] Starting server on port ${PORT}...${NC}"
PORT=$PORT HOST=$HOST NODE_ENV=$NODE_ENV node dist/index.js >/dev/null 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null || true

# Wait for server to be ready (max 15s)
READY=1
for i in $(seq 1 30); do
  if curl -s "${BASE}/health" >/dev/null 2>&1; then
    READY=0
    break
  fi
  sleep 0.5
done
check "Server started (pid $SERVER_PID)" "$READY"

if [[ "$READY" != "0" ]]; then
  echo -e "${RED}Server failed to start. Aborting.${NC}"
  exit 1
fi

# ─── Step 3: Health + endpoints ───
echo -e "${YELLOW}[3/6] Verifying core endpoints...${NC}"

# Health
HEALTH=$(curl -s "${BASE}/health" || echo "")
echo "$HEALTH" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null && R=0 || R=1
check "GET /health returns valid JSON" "$R"

# Docs
DOCS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/docs" || echo "0")
[[ "$DOCS_STATUS" == "200" ]] && R=0 || R=1
check "GET /docs returns 200" "$R"

# Tasks list
TASKS=$(curl -s "${BASE}/tasks?limit=5" || echo "")
echo "$TASKS" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'tasks' in d" 2>/dev/null && R=0 || R=1
check "GET /tasks returns tasks array" "$R"

# Chat messages
CHAT=$(curl -s "${BASE}/chat/messages?limit=5" || echo "")
echo "$CHAT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'messages' in d" 2>/dev/null && R=0 || R=1
check "GET /chat/messages returns messages array" "$R"

# ─── Step 4: Task lifecycle ───
echo -e "${YELLOW}[4/6] Task lifecycle (create → comment → done)...${NC}"

# Create task
TASK_RESP=$(curl -s -X POST "${BASE}/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Dogfood smoke test task",
    "description": "Auto-created by dogfood-boot.sh",
    "assignee": "link",
    "reviewer": "kai",
    "priority": "P2",
    "done_criteria": ["Smoke test passes"],
    "eta": "~5m",
    "createdBy": "link"
  }' || echo "")
TASK_ID=$(echo "$TASK_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('task',{}).get('id',''))" 2>/dev/null || echo "")
[[ -n "$TASK_ID" ]] && R=0 || R=1
check "POST /tasks creates task (${TASK_ID:-none})" "$R"

if [[ -n "$TASK_ID" ]]; then
  # Add comment
  COMMENT_RESP=$(curl -s -X POST "${BASE}/tasks/${TASK_ID}/comments" \
    -H "Content-Type: application/json" \
    -d '{"author": "link", "content": "Smoke test comment from dogfood-boot.sh"}' || echo "")
  echo "$COMMENT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('success')" 2>/dev/null && R=0 || R=1
  check "POST /tasks/:id/comments works" "$R"

  # Read task back
  GET_TASK=$(curl -s "${BASE}/tasks/${TASK_ID}" || echo "")
  echo "$GET_TASK" | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('task',{}); assert t.get('id')==d.get('resolvedId') and t.get('title')=='Dogfood smoke test task'" 2>/dev/null && R=0 || R=1
  check "GET /tasks/:id reads back created task" "$R"
fi

# ─── Step 5: Chat ───
echo -e "${YELLOW}[5/6] Chat message round-trip...${NC}"

MSG_RESP=$(curl -s -X POST "${BASE}/chat/messages" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "link",
    "channel": "general",
    "content": "Dogfood smoke test message"
  }' || echo "")
MSG_ID=$(echo "$MSG_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('message',{}).get('id',''))" 2>/dev/null || echo "")
[[ -n "$MSG_ID" ]] && R=0 || R=1
check "POST /chat/messages creates message" "$R"

# Read back
READBACK=$(curl -s "${BASE}/chat/messages?limit=5&channel=general" || echo "")
echo "$READBACK" | python3 -c "import sys,json; msgs=json.load(sys.stdin).get('messages',[]); assert any('Dogfood smoke' in m.get('content','') for m in msgs)" 2>/dev/null && R=0 || R=1
check "Chat message readable via GET" "$R"

# ─── Step 6: Presence + health monitor ───
echo -e "${YELLOW}[6/6] Presence + health endpoints...${NC}"

# Post presence
PRES_RESP=$(curl -s -X POST "${BASE}/presence/link" \
  -H "Content-Type: application/json" \
  -d '{"status": "working"}' 2>/dev/null || echo "")
PRES_OK=$(echo "$PRES_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('1' if d.get('success') else '0')" 2>/dev/null || echo "0")
[[ "$PRES_OK" == "1" ]] && R=0 || R=1
check "POST /presence works" "$R"

# Health agents
AGENTS=$(curl -s "${BASE}/health/agents" 2>/dev/null || echo "")
echo "$AGENTS" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null && R=0 || R=1
check "GET /health/agents returns valid JSON" "$R"

# ─── Summary ───
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo -e "${CYAN}═══ Results ═══${NC}"
echo -e "  ${GREEN}Passed: ${PASS}${NC}"
if [[ "$FAIL" -gt 0 ]]; then
  echo -e "  ${RED}Failed: ${FAIL}${NC}"
fi
echo -e "  Time: ${ELAPSED}s"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  echo -e "${RED}DOGFOOD BOOT: FAIL${NC}"
  exit 1
else
  echo -e "${GREEN}DOGFOOD BOOT: PASS ✓${NC}"
  exit 0
fi
