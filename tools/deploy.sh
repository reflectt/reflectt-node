#!/usr/bin/env bash
#
# deploy.sh — Zero-downtime deploy for reflectt-node
#
# Usage: ./tools/deploy.sh [--skip-pull] [--skip-build]
#
# Steps:
#   1. Pull latest main
#   2. npm run build
#   3. Restart via LaunchAgent (graceful)
#   4. Wait for /health to respond
#   5. Verify SSE subscribers reconnect
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_LABEL="com.reflectt.node"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
SERVER_URL="${REFLECTT_NODE_URL:-http://127.0.0.1:4445}"
HEALTH_TIMEOUT=30       # seconds to wait for health
SSE_CHECK_TIMEOUT=30    # seconds to wait for SSE reconnect
NODE_BIN="${NODE_BIN:-$(which node 2>/dev/null || echo /opt/homebrew/bin/node)}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[deploy]${NC} $*"; }
ok()   { echo -e "${GREEN}[deploy]${NC} ✅ $*"; }
warn() { echo -e "${YELLOW}[deploy]${NC} ⚠️  $*"; }
fail() { echo -e "${RED}[deploy]${NC} ❌ $*"; exit 1; }

SKIP_PULL=false
SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-pull)  SKIP_PULL=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --help|-h)
      echo "Usage: ./tools/deploy.sh [--skip-pull] [--skip-build]"
      exit 0
      ;;
  esac
done

cd "$REPO_DIR"

# ── Step 1: Pull latest ──
if [ "$SKIP_PULL" = false ]; then
  log "Pulling latest main..."
  git checkout main 2>/dev/null || true
  git pull origin main --ff-only || fail "git pull failed — resolve conflicts first"
  ok "Pulled latest main"
else
  warn "Skipping git pull (--skip-pull)"
fi

# ── Step 2: Build ──
if [ "$SKIP_BUILD" = false ]; then
  log "Building..."
  npm run build || fail "Build failed"
  ok "Build succeeded"
else
  warn "Skipping build (--skip-build)"
fi

# ── Step 3: Restart server via LaunchAgent ──
log "Restarting reflectt-node..."

if [ -f "$PLIST_PATH" ]; then
  # LaunchAgent managed
  launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
  sleep 1
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
  ok "LaunchAgent restarted"
else
  # Fallback: kill + restart directly
  warn "No LaunchAgent found, using direct restart"
  pkill -f "node dist/index.js" 2>/dev/null || true
  sleep 1
  nohup "$NODE_BIN" dist/index.js > /tmp/reflectt-node.log 2>&1 &
  ok "Server started (PID: $!)"
fi

# ── Step 4: Wait for health ──
log "Waiting for server health..."
elapsed=0
while [ $elapsed -lt $HEALTH_TIMEOUT ]; do
  if curl -s --max-time 2 "${SERVER_URL}/health" | grep -q '"status":"ok"' 2>/dev/null; then
    ok "Server healthy (${elapsed}s)"
    break
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

if [ $elapsed -ge $HEALTH_TIMEOUT ]; then
  fail "Server did not become healthy within ${HEALTH_TIMEOUT}s"
fi

# ── Step 5: Restart OpenClaw gateway ──
# SIGUSR1 (soft reload) kills the SSE plugin's abortSignal permanently
# and startAccount never re-runs. Full restart is required.
log "Restarting OpenClaw gateway (full restart for SSE plugin re-init)..."
if command -v openclaw &>/dev/null; then
  openclaw gateway restart 2>/dev/null && ok "Gateway restart triggered" || warn "Gateway restart failed"
  sleep 5
else
  warn "openclaw CLI not found — gateway restart skipped"
  warn "Run manually: openclaw gateway restart"
fi

# ── Step 6: Wait for SSE reconnect ──
log "Waiting for SSE subscribers to reconnect..."
elapsed=0
while [ $elapsed -lt $SSE_CHECK_TIMEOUT ]; do
  connected=$(curl -s --max-time 2 "${SERVER_URL}/events/status" 2>/dev/null | \
    python3 -c "import sys,json; print(json.load(sys.stdin).get('connected',0))" 2>/dev/null || echo "0")
  
  if [ "$connected" -gt 0 ] 2>/dev/null; then
    ok "SSE connected: ${connected} subscriber(s) (${elapsed}s)"
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

if [ $elapsed -ge $SSE_CHECK_TIMEOUT ]; then
  warn "No SSE subscribers after ${SSE_CHECK_TIMEOUT}s"
  warn "Check: openclaw gateway status"
fi

# ── Summary ──
echo ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "Deploy complete"
curl -s --max-time 2 "${SERVER_URL}/health" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print(f'  Tasks: {d[\"tasks\"][\"total\"]} ({d[\"tasks\"][\"byStatus\"]})')
print(f'  Chat:  {d[\"chat\"][\"totalMessages\"]} messages')
print(f'  Inbox: {d[\"inbox\"][\"agents\"]} agents')
" 2>/dev/null || true
echo ""
