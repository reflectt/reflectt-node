#!/usr/bin/env bash
# post-merge-rebuild.sh — Auto-rebuild and restart reflectt-node after git pull
# Installed as .git/hooks/post-merge
#
# What it does:
#   1. Checks if any .ts files changed in the merge
#   2. If yes: npm run build → restart the service
#   3. If only docs/config changed: skip rebuild
#
# The service is managed via PID file at /tmp/reflectt-node.pid
# Logs go to /tmp/reflectt-node-rebuild.log

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PID_FILE="/tmp/reflectt-node.pid"
LOG_FILE="/tmp/reflectt-node-rebuild.log"
SERVICE_LOG="/tmp/reflectt-node.log"

# Ensure PATH includes node/npm
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

cd "$REPO_DIR"

# Check what changed in the merge
CHANGED_FILES=$(git diff-tree -r --name-only --no-commit-id ORIG_HEAD HEAD 2>/dev/null || echo "")

if [ -z "$CHANGED_FILES" ]; then
  log "post-merge: no file changes detected, skipping"
  exit 0
fi

# Check if any TypeScript source or package files changed
NEEDS_REBUILD=false
if echo "$CHANGED_FILES" | grep -qE '\.(ts|tsx)$|package\.json|package-lock\.json|tsconfig\.json'; then
  NEEDS_REBUILD=true
fi

if [ "$NEEDS_REBUILD" = false ]; then
  log "post-merge: only non-source files changed (docs/config), skipping rebuild"
  log "  Changed: $(echo "$CHANGED_FILES" | tr '\n' ' ')"
  exit 0
fi

log "post-merge: source files changed, rebuilding..."
log "  Changed: $(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$|package' | tr '\n' ' ')"

# Check if package.json changed (need npm install)
if echo "$CHANGED_FILES" | grep -q 'package\.json\|package-lock\.json'; then
  log "post-merge: package.json changed, running npm install..."
  npm install --silent 2>&1 | tail -5 | tee -a "$LOG_FILE"
fi

# Build
log "post-merge: running npm run build..."
if npm run build 2>&1 | tee -a "$LOG_FILE"; then
  log "post-merge: build succeeded"
else
  log "post-merge: BUILD FAILED — not restarting service"
  exit 1
fi

# Run tests
log "post-merge: running tests..."
if npm test 2>&1 | tail -10 | tee -a "$LOG_FILE"; then
  log "post-merge: tests passed"
else
  log "post-merge: TESTS FAILED — not restarting service"
  exit 1
fi

# Restart service
# The service itself handles PID lockfile + port conflict cleanup on startup.
# We just need to start the new instance — it will kill the old one.
log "post-merge: starting new service (PID lockfile manager will handle old instance)..."
nohup node dist/index.js >> "$SERVICE_LOG" 2>&1 &
NEW_PID=$!

# Wait and verify
sleep 3
if curl -sf http://127.0.0.1:4445/health > /dev/null 2>&1; then
  log "post-merge: service restarted successfully (pid $NEW_PID)"
  # Quick health summary
  HEALTH=$(curl -s http://127.0.0.1:4445/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'status={d[\"status\"]} tasks={d[\"tasks\"][\"total\"]}')" 2>/dev/null || echo "")
  log "post-merge: health: $HEALTH"
else
  log "post-merge: WARNING — service may not have started correctly (pid $NEW_PID)"
  log "post-merge: check $SERVICE_LOG for details"
fi

# Nudge OpenClaw gateway to reconnect SSE
# The reflectt channel plugin's SSE stream breaks when the service restarts.
# Sending SIGUSR1 triggers a graceful gateway restart which re-establishes the connection.
OPENCLAW_PID=$(pgrep -f "openclaw.*gateway" 2>/dev/null | head -1 || echo "")
if [ -z "$OPENCLAW_PID" ]; then
  # Try launchctl
  OPENCLAW_PID=$(launchctl list 2>/dev/null | grep openclaw | awk '{print $1}' | head -1 || echo "")
fi
if [ -n "$OPENCLAW_PID" ] && [ "$OPENCLAW_PID" != "-" ] && kill -0 "$OPENCLAW_PID" 2>/dev/null; then
  log "post-merge: nudging OpenClaw gateway (pid $OPENCLAW_PID) to reconnect..."
  kill -USR1 "$OPENCLAW_PID" 2>/dev/null || true
  log "post-merge: gateway restart signal sent"
else
  log "post-merge: OpenClaw gateway PID not found — manual restart may be needed for mention delivery"
fi

log "post-merge: done"
