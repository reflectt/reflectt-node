#!/usr/bin/env bash
# Unified Reflectt Installer — installs OpenClaw + reflectt-node in one script
# Source of truth: reflectt-node/scripts/install.sh
# Served at: https://reflectt.ai/install.sh
#
# Usage: curl -fsSL https://reflectt.ai/install.sh | bash
#
# Phases:
#   1. Preflight — check deps, detect OS, check partial state
#   2. OpenClaw — install if missing (npm install -g openclaw)
#   3. reflectt-node — clone/update, npm install, build
#   4. Runtime — start reflectt-node, health check, verify endpoints
#   5. Report — emit telemetry, print success

set -u

# ── Configuration ───────────────────────────────────────────────────────────

INSTALL_CMD="curl -fsSL https://reflectt.ai/install.sh | bash"
TELEMETRY_DIR="${HOME}/.reflectt"
TELEMETRY_FILE="${TELEMETRY_DIR}/install-telemetry.jsonl"
PARTIAL_MARKER_DIR="${HOME}/.reflectt"
PARTIAL_MARKER_FILE="${PARTIAL_MARKER_DIR}/.reflectt-install.partial"

# OpenClaw
NPM_PACKAGE="openclaw"
NPM_VERSION="${OPENCLAW_INSTALL_VERSION:-latest}"
TARBALL_URL="${OPENCLAW_TARBALL_URL:-}"

# reflectt-node
REFLECTT_NODE_REPO="${REFLECTT_NODE_REPO:-https://github.com/reflectt/reflectt-node.git}"
REFLECTT_NODE_DIR="${REFLECTT_NODE_DIR:-${HOME}/.reflectt/reflectt-node}"
REFLECTT_NODE_BRANCH="${REFLECTT_NODE_BRANCH:-main}"
REFLECTT_NODE_PORT="${REFLECTT_NODE_PORT:-4445}"
REFLECTT_NODE_PID_FILE="${REFLECTT_NODE_PID_FILE:-${HOME}/.reflectt/reflectt-node.pid}"

# ── Helpers ─────────────────────────────────────────────────────────────────

info()    { echo "INFO: $*"; }
warn()    { echo "WARN: $*"; }
err()     { echo "ERROR: $*" >&2; }
success() { echo "SUCCESS: $*"; }

emit_telemetry() {
  local outcome="$1"
  local reason="$2"
  local phase="${3:-unknown}"
  local os_name
  os_name="$(uname -s 2>/dev/null || echo unknown)"
  local ts
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)"

  mkdir -p "$TELEMETRY_DIR" 2>/dev/null || true
  printf '{"timestamp":"%s","outcome":"%s","reason":"%s","phase":"%s","os":"%s"}\n' \
    "$ts" "$outcome" "$reason" "$phase" "$os_name" >> "$TELEMETRY_FILE" 2>/dev/null || true
}

exit_fail() {
  local reason="$1"
  local phase="${2:-unknown}"
  emit_telemetry "failure" "$reason" "$phase"
  err "Install failed: $reason"
  err "Fix the issue above, then rerun:"
  err "  $INSTALL_CMD"
  exit 1
}

wait_for_health() {
  local tries=20
  local url="http://127.0.0.1:${REFLECTT_NODE_PORT}/health"
  for _ in $(seq 1 "$tries"); do
    if curl -fsS "$url" 2>/dev/null | grep -q '"status":"ok"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

verify_endpoints() {
  local base="http://127.0.0.1:${REFLECTT_NODE_PORT}"
  curl -fsS "$base/health" >/dev/null 2>&1 || return 1
  curl -fsS "$base/health/agents" >/dev/null 2>&1 || return 1
  curl -fsS "$base/tasks?limit=1" >/dev/null 2>&1 || return 1
}

# ── Phase 1: Preflight ─────────────────────────────────────────────────────

info "Starting Reflectt unified installer."
info "Phase 1/4: Preflight checks..."

# Required dependencies
for dep in bash curl git node npm tar; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    err "Missing required dependency: ${dep}."
    case "$dep" in
      node|npm) err "Install Node.js 18+: https://nodejs.org" ;;
      git)      err "Install git: https://git-scm.com" ;;
      *)        err "Install ${dep} via your system package manager." ;;
    esac
    exit_fail "missing_dependency_${dep}" "preflight"
  fi
done

# jq is recommended but not blocking
HAS_JQ=0
if command -v jq >/dev/null 2>&1; then
  HAS_JQ=1
fi

# Detect partial install from previous interrupted run
if [ -f "$PARTIAL_MARKER_FILE" ]; then
  warn "Detected partial install state from a previously interrupted run."
  info "Running safe-rerun checks..."

  if [ "${REFLECTT_FORCE_PARTIAL_FAIL:-0}" = "1" ]; then
    exit_fail "partial_state_cleanup_required" "preflight"
  fi

  if [ -w "$PARTIAL_MARKER_DIR" ]; then
    info "Safe-rerun checks passed. Resuming install..."
    rm -f "$PARTIAL_MARKER_FILE" 2>/dev/null || true
  else
    err "Safe-rerun checks failed. Run cleanup first:"
    err "  rm -f '$PARTIAL_MARKER_FILE'"
    exit_fail "partial_state_cleanup_required" "preflight"
  fi
fi

# Create partial marker
mkdir -p "$PARTIAL_MARKER_DIR" 2>/dev/null || exit_fail "permission_denied" "preflight"
printf 'partial\n' > "$PARTIAL_MARKER_FILE" 2>/dev/null || exit_fail "permission_denied" "preflight"

info "Preflight passed."

# ── Phase 2: OpenClaw ──────────────────────────────────────────────────────

info "Phase 2/4: OpenClaw runtime..."

if command -v openclaw >/dev/null 2>&1 && [ "${REFLECTT_INSTALL_ALLOW_EXISTING:-0}" != "1" ]; then
  OPENCLAW_PATH="$(command -v openclaw)"
  OPENCLAW_VER="$(openclaw --version 2>/dev/null || echo unknown)"
  info "OpenClaw already installed: ${OPENCLAW_VER} at ${OPENCLAW_PATH}"
else
  info "Installing OpenClaw (npm install -g ${NPM_PACKAGE}@${NPM_VERSION})..."

  if [ "${REFLECTT_INSTALL_TEST_MODE:-0}" = "1" ]; then
    # Test mode: create mock binary
    TMP_DIR="$(mktemp -d 2>/dev/null || echo /tmp/reflectt-install.$$)"
    MOCK_BIN_DIR="${TMP_DIR}/mock-bin"
    mkdir -p "$MOCK_BIN_DIR"
    cat > "${MOCK_BIN_DIR}/openclaw" <<'MOCKEOF'
#!/usr/bin/env bash
echo "openclaw test-0.0.0"
MOCKEOF
    chmod +x "${MOCK_BIN_DIR}/openclaw"
    export PATH="${MOCK_BIN_DIR}:$PATH"
    info "Test mode: using mock OpenClaw binary."
  else
    install_output=""
    if ! install_output="$(npm install -g "${NPM_PACKAGE}@${NPM_VERSION}" 2>&1)"; then
      if echo "$install_output" | grep -Eiq 'EACCES|permission denied'; then
        err "Permission denied installing OpenClaw."
        err "Try: sudo npm install -g ${NPM_PACKAGE}@${NPM_VERSION}"
        exit_fail "permission_denied" "openclaw"
      fi
      err "npm install failed. Output:"
      echo "$install_output" >&2
      exit_fail "npm_install_failed" "openclaw"
    fi
  fi

  OPENCLAW_PATH="$(command -v openclaw 2>/dev/null || echo unknown)"
  OPENCLAW_VER="$(openclaw --version 2>/dev/null || echo unknown)"

  if [ "$OPENCLAW_PATH" = "unknown" ]; then
    exit_fail "openclaw_not_on_path" "openclaw"
  fi

  success "Installed OpenClaw ${OPENCLAW_VER} at ${OPENCLAW_PATH}."
  emit_telemetry "success" "openclaw_installed" "openclaw"
fi

# ── Phase 3: reflectt-node ─────────────────────────────────────────────────

info "Phase 3/4: reflectt-node..."

mkdir -p "$(dirname "$REFLECTT_NODE_DIR")" 2>/dev/null || exit_fail "permission_denied" "reflectt-node"

if [ -d "$REFLECTT_NODE_DIR/.git" ]; then
  info "Updating existing reflectt-node checkout at ${REFLECTT_NODE_DIR}"
  if ! git -C "$REFLECTT_NODE_DIR" fetch origin 2>/dev/null; then
    exit_fail "git_fetch_failed" "reflectt-node"
  fi
  git -C "$REFLECTT_NODE_DIR" checkout "$REFLECTT_NODE_BRANCH" 2>/dev/null || true
  if ! git -C "$REFLECTT_NODE_DIR" pull --ff-only origin "$REFLECTT_NODE_BRANCH" 2>/dev/null; then
    warn "Pull failed (diverged). Using existing checkout."
  fi
else
  info "Cloning reflectt-node into ${REFLECTT_NODE_DIR}"
  rm -rf "$REFLECTT_NODE_DIR"
  if ! git clone --branch "$REFLECTT_NODE_BRANCH" "$REFLECTT_NODE_REPO" "$REFLECTT_NODE_DIR" 2>/dev/null; then
    exit_fail "git_clone_failed" "reflectt-node"
  fi
fi

info "Installing dependencies..."
if ! npm --prefix "$REFLECTT_NODE_DIR" install 2>/dev/null; then
  exit_fail "npm_install_failed" "reflectt-node"
fi

info "Building reflectt-node..."
if ! npm --prefix "$REFLECTT_NODE_DIR" run build 2>/dev/null; then
  exit_fail "build_failed" "reflectt-node"
fi

success "reflectt-node built successfully."
emit_telemetry "success" "reflectt_node_built" "reflectt-node"

# ── Phase 4: Runtime Health ─────────────────────────────────────────────────

info "Phase 4/4: Starting runtime and verifying..."

# Stop existing process if running
if [ -f "$REFLECTT_NODE_PID_FILE" ]; then
  old_pid="$(cat "$REFLECTT_NODE_PID_FILE" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    info "Stopping previous reflectt-node process: ${old_pid}"
    kill "$old_pid" 2>/dev/null || true
    sleep 2
  fi
fi

info "Starting reflectt-node on port ${REFLECTT_NODE_PORT}..."
nohup env PORT="$REFLECTT_NODE_PORT" NODE_ENV=production node "$REFLECTT_NODE_DIR/dist/index.js" \
  >/tmp/reflectt-node-install.log 2>&1 &
new_pid=$!
echo "$new_pid" > "$REFLECTT_NODE_PID_FILE"

info "Waiting for health check..."
if ! wait_for_health; then
  err "Health check failed after 20 seconds."
  err "Logs:"
  tail -n 30 /tmp/reflectt-node-install.log 2>/dev/null || true
  exit_fail "health_check_timeout" "runtime"
fi

if ! verify_endpoints; then
  err "API endpoint verification failed."
  tail -n 20 /tmp/reflectt-node-install.log 2>/dev/null || true
  exit_fail "endpoint_verification_failed" "runtime"
fi

# ── Done ────────────────────────────────────────────────────────────────────

rm -f "$PARTIAL_MARKER_FILE" 2>/dev/null || true
emit_telemetry "success" "install_complete" "done"

echo ""
success "═══════════════════════════════════════════════════════"
success "  Reflectt is installed and running!"
success "═══════════════════════════════════════════════════════"
echo ""
success "  OpenClaw:      ${OPENCLAW_VER}"
success "  reflectt-node: http://127.0.0.1:${REFLECTT_NODE_PORT}"
success "  Health:        http://127.0.0.1:${REFLECTT_NODE_PORT}/health"
echo ""
success "  Verify manually:"
success "    curl -fsS http://127.0.0.1:${REFLECTT_NODE_PORT}/health | jq ."
success "    curl -fsS http://127.0.0.1:${REFLECTT_NODE_PORT}/health/agents | jq ."
echo ""
success "  Next: Connect to Reflectt Cloud"
success "    → https://app.reflectt.ai/bootstrap"
echo ""

exit 0
