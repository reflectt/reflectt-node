#!/usr/bin/env bash
# post-merge-rebuild.sh — Auto-rebuild and restart reflectt-node after git pull
# Installed as .git/hooks/post-merge
#
# What it does:
#   1. Checks if any .ts/package files changed in the merge
#   2. If yes: npm install (if needed) → npm run build → npm test → restart
#   3. If only docs/config changed: skip rebuild but still nudge gateway
#   4. ALWAYS nudges the OpenClaw gateway (SSE breaks on any service restart)
#
# The service is managed via PID lockfile at /tmp/reflectt-node.pid
# Logs go to /tmp/reflectt-node-rebuild.log

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_FILE="/tmp/reflectt-node-rebuild.log"
SERVICE_LOG="/tmp/reflectt-node.log"

# Ensure PATH includes node/npm
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Always nudge gateway — call this at the end regardless of rebuild
nudge_gateway() {
  local OPENCLAW_PID=""
  OPENCLAW_PID=$(pgrep -f "openclaw.*gateway" 2>/dev/null | head -1 || echo "")
  if [ -z "$OPENCLAW_PID" ]; then
    OPENCLAW_PID=$(launchctl list 2>/dev/null | grep openclaw | awk '{print $1}' | head -1 || echo "")
  fi
  if [ -n "$OPENCLAW_PID" ] && [ "$OPENCLAW_PID" != "-" ] && kill -0 "$OPENCLAW_PID" 2>/dev/null; then
    log "post-merge: nudging OpenClaw gateway (pid $OPENCLAW_PID) to reconnect..."
    kill -USR1 "$OPENCLAW_PID" 2>/dev/null || true
    log "post-merge: gateway restart signal sent"
  else
    log "post-merge: OpenClaw gateway PID not found — manual restart may be needed"
  fi
}

cd "$REPO_DIR"

# Detect what changed — robust approach using ORIG_HEAD
# ORIG_HEAD is set by git-pull/git-merge to the tip before the merge
# If ORIG_HEAD doesn't exist or is invalid, always rebuild (safe default)
CHANGED_FILES=""
if git rev-parse --verify ORIG_HEAD >/dev/null 2>&1; then
  CURRENT_HEAD=$(git rev-parse HEAD)
  ORIG=$(git rev-parse ORIG_HEAD)
  
  if [ "$CURRENT_HEAD" = "$ORIG" ]; then
    log "post-merge: HEAD unchanged (already up-to-date), nudging gateway only"
    nudge_gateway
    log "post-merge: done"
    exit 0
  fi

  CHANGED_FILES=$(git diff --name-only "$ORIG" "$CURRENT_HEAD" 2>/dev/null || echo "")
  log "post-merge: diff $ORIG..$CURRENT_HEAD"
else
  log "post-merge: ORIG_HEAD not available — assuming full rebuild needed"
fi

# If we couldn't determine changes, always rebuild (safe default)
if [ -z "$CHANGED_FILES" ]; then
  log "post-merge: no changes detected or ORIG_HEAD unavailable — forcing rebuild"
  NEEDS_REBUILD=true
else
  log "post-merge: changed files:"
  echo "$CHANGED_FILES" | head -20 | while read -r f; do log "  $f"; done

  # Check if any TypeScript source or package files changed
  NEEDS_REBUILD=false
  if echo "$CHANGED_FILES" | grep -qE '\.(ts|tsx)$|package\.json|package-lock\.json|tsconfig\.json'; then
    NEEDS_REBUILD=true
  fi
fi

if [ "$NEEDS_REBUILD" = false ]; then
  log "post-merge: only non-source files changed, skipping rebuild"
  nudge_gateway
  log "post-merge: done"
  exit 0
fi

log "post-merge: source files changed, rebuilding..."

# Check if package.json changed (need npm install)
if [ -n "$CHANGED_FILES" ] && echo "$CHANGED_FILES" | grep -q 'package\.json\|package-lock\.json'; then
  log "post-merge: package.json changed, running npm install..."
  npm install --silent 2>&1 | tail -5 | tee -a "$LOG_FILE"
fi

# Build
log "post-merge: running npm run build..."
if npm run build 2>&1 | tee -a "$LOG_FILE"; then
  log "post-merge: build succeeded"
else
  log "post-merge: BUILD FAILED — not restarting service"
  nudge_gateway
  exit 1
fi

# Run tests
log "post-merge: running tests..."
if npm test 2>&1 | tail -10 | tee -a "$LOG_FILE"; then
  log "post-merge: tests passed"
else
  log "post-merge: TESTS FAILED — not restarting service"
  nudge_gateway
  exit 1
fi

# Restart service
# The service itself handles PID lockfile + port conflict cleanup on startup.
log "post-merge: starting new service (PID lockfile manager will handle old instance)..."

MAX_ATTEMPTS=3
ATTEMPT=0
NEW_PID=""

while [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  log "post-merge: start attempt $ATTEMPT/$MAX_ATTEMPTS..."

  nohup node dist/index.js >> "$SERVICE_LOG" 2>&1 &
  NEW_PID=$!

  # Wait with progressive backoff: 4s, 6s, 8s
  WAIT_SECS=$((2 + ATTEMPT * 2))
  sleep "$WAIT_SECS"

  # Verify: process must be alive AND health endpoint must respond
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    log "post-merge: process $NEW_PID died on attempt $ATTEMPT"
    continue
  fi

  if curl -sf http://127.0.0.1:4445/health > /dev/null 2>&1; then
    HEALTH=$(curl -s http://127.0.0.1:4445/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'status={d[\"status\"]} tasks={d[\"tasks\"][\"total\"]}')" 2>/dev/null || echo "")
    log "post-merge: service restarted successfully (pid $NEW_PID, attempt $ATTEMPT)"
    log "post-merge: health: $HEALTH"
    break
  fi

  log "post-merge: health check failed on attempt $ATTEMPT (pid $NEW_PID)"
  kill "$NEW_PID" 2>/dev/null || true
  sleep 1

  if [ "$ATTEMPT" -eq "$MAX_ATTEMPTS" ]; then
    log "post-merge: FAILED after $MAX_ATTEMPTS attempts — service may be down"
    log "post-merge: manual restart required: cd $REPO_DIR && node dist/index.js"
    nohup node dist/index.js >> "$SERVICE_LOG" 2>&1 &
    NEW_PID=$!
    log "post-merge: last-resort spawn (pid $NEW_PID)"
  fi
done

# Always nudge gateway after any merge (SSE reconnect)
nudge_gateway

log "post-merge: done"
