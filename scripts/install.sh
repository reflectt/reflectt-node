#!/usr/bin/env bash
# reflectt-node staging installer source path (v1 fresh-install only)
# NOTE: This is a staging source for task-1771516486082-jllhf3izl.
# Deploy wiring to https://reflectt.ai/install.sh is intentionally out of scope here.

set -u

INSTALL_CMD="curl -fsSL https://reflectt.ai/install.sh | bash"
TELEMETRY_DIR="${HOME}/.reflectt"
TELEMETRY_FILE="${TELEMETRY_DIR}/install-telemetry.jsonl"
PARTIAL_MARKER_DIR="${HOME}/.reflectt/openclaw"
PARTIAL_MARKER_FILE="${PARTIAL_MARKER_DIR}/.reflectt-install.partial"
CLEANUP_COMMAND="rm -rf '${PARTIAL_MARKER_DIR}'"
NPM_PACKAGE="openclaw"
NPM_VERSION="${OPENCLAW_INSTALL_VERSION:-latest}"
TARBALL_URL="${OPENCLAW_TARBALL_URL:-}"

info() { echo "INFO: $*"; }
warn() { echo "WARN: $*"; }
err() { echo "ERROR: $*" >&2; }
success() { echo "SUCCESS: $*"; }

emit_telemetry() {
  local outcome="$1"
  local reason="$2"
  local os_name="$(uname -s 2>/dev/null || echo unknown)"
  local ts
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo unknown)"

  mkdir -p "$TELEMETRY_DIR" 2>/dev/null || true
  printf '{"timestamp":"%s","outcome":"%s","reason":"%s","os":"%s"}\n' \
    "$ts" "$outcome" "$reason" "$os_name" >> "$TELEMETRY_FILE" 2>/dev/null || true
}

exit_fail() {
  local reason="$1"
  emit_telemetry "failure" "$reason"
  exit 1
}

missing_dependency_block() {
  err "Missing required dependency: jq."
  err "Install jq, then rerun this command."
  err "macOS: brew install jq"
  err "Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y jq"
  exit_fail "missing_dependency"
}

network_failure_block() {
  err "Download failed (network timeout)."
  err "Check internet connectivity, then rerun:"
  err "$INSTALL_CMD"
  exit_fail "network_download_failure"
}

existing_install_block() {
  local existing_path="$1"
  err "Existing OpenClaw installation detected at ${existing_path}."
  err "This installer supports fresh installs only in v1 (no upgrade/migration path)."
  err "Next step: run this installer on a clean machine/environment."
  exit_fail "existing_install_detected"
}

permission_denied_block() {
  local install_path="$1"
  err "Cannot write to ${install_path} (permission denied)."
  err "Use a writable install path or grant permission for this step, then rerun:"
  err "$INSTALL_CMD"
  exit_fail "permission_denied"
}

partial_state_block_or_resume() {
  warn "Detected partial install state from a previously interrupted run."
  info "Running safe-rerun checks..."

  if [ "${REFLECTT_FORCE_PARTIAL_FAIL:-0}" = "1" ]; then
    err "Safe-rerun checks failed due to inconsistent partial state."
    err "Run cleanup, then rerun installer:"
    err "$CLEANUP_COMMAND"
    err "$INSTALL_CMD"
    exit_fail "partial_state_cleanup_required"
  fi

  if [ -w "$PARTIAL_MARKER_DIR" ]; then
    info "Safe-rerun checks passed."
    info "Resuming install..."
    rm -f "$PARTIAL_MARKER_FILE" 2>/dev/null || true
    return 0
  fi

  err "Safe-rerun checks failed due to inconsistent partial state."
  err "Run cleanup, then rerun installer:"
  err "$CLEANUP_COMMAND"
  err "$INSTALL_CMD"
  exit_fail "partial_state_cleanup_required"
}

# Start copy contract
info "Starting Reflectt install (v1, fresh machine only)."
info "Validating preconditions..."

if ! command -v jq >/dev/null 2>&1 || [ "${REFLECTT_SIMULATE_MISSING_JQ:-0}" = "1" ]; then
  missing_dependency_block
fi

for dep in curl bash tar npm node; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    err "Missing required dependency: ${dep}."
    err "Install ${dep}, then rerun this command."
    exit_fail "missing_dependency_${dep}"
  fi
done

if [ -f "$PARTIAL_MARKER_FILE" ]; then
  partial_state_block_or_resume
fi

if [ "${REFLECTT_INSTALL_ALLOW_EXISTING:-0}" != "1" ] && command -v openclaw >/dev/null 2>&1; then
  existing_install_block "$(command -v openclaw)"
fi

mkdir -p "$PARTIAL_MARKER_DIR" 2>/dev/null || permission_denied_block "$PARTIAL_MARKER_DIR"
printf 'partial\n' > "$PARTIAL_MARKER_FILE" 2>/dev/null || permission_denied_block "$PARTIAL_MARKER_FILE"

info "Checking dependencies: curl, bash, tar, jq..."
info "Downloading installer payload..."

if [ -z "$TARBALL_URL" ]; then
  TARBALL_URL="$(npm view "${NPM_PACKAGE}@${NPM_VERSION}" dist.tarball --silent 2>/dev/null || true)"
fi

if [ -z "$TARBALL_URL" ]; then
  network_failure_block
fi

TMP_DIR="$(mktemp -d 2>/dev/null || echo /tmp/reflectt-install.$$)"
PAYLOAD_TGZ="${TMP_DIR}/openclaw.tgz"

if [ "${REFLECTT_SIMULATE_NETWORK_FAIL:-0}" = "1" ]; then
  network_failure_block
fi

if ! curl -fsSL "$TARBALL_URL" -o "$PAYLOAD_TGZ"; then
  network_failure_block
fi

info "Verifying payload integrity..."
if ! tar -tzf "$PAYLOAD_TGZ" >/dev/null 2>&1; then
  err "Downloaded payload failed integrity check."
  err "Check internet connectivity, then rerun:"
  err "$INSTALL_CMD"
  exit_fail "payload_integrity_failed"
fi

info "Installing OpenClaw binaries..."

if [ "${REFLECTT_INSTALL_TEST_MODE:-0}" = "1" ]; then
  MOCK_BIN_DIR="${TMP_DIR}/mock-bin"
  mkdir -p "$MOCK_BIN_DIR"
  cat > "${MOCK_BIN_DIR}/openclaw" <<'EOF'
#!/usr/bin/env bash
echo "openclaw test-0.0.0"
EOF
  chmod +x "${MOCK_BIN_DIR}/openclaw"
  export PATH="${MOCK_BIN_DIR}:$PATH"
else
  install_output=""
  if ! install_output="$(npm install -g "${NPM_PACKAGE}@${NPM_VERSION}" 2>&1)"; then
    if echo "$install_output" | grep -Eiq 'EACCES|permission denied'; then
      permission_denied_block "$(npm config get prefix 2>/dev/null || echo global npm prefix)"
    fi
    err "Install failed while running npm install -g ${NPM_PACKAGE}@${NPM_VERSION}."
    err "Next step: review error output and rerun installer."
    exit_fail "npm_install_failed"
  fi
fi

OPENCLAW_PATH="$(command -v openclaw 2>/dev/null || true)"
if [ -z "$OPENCLAW_PATH" ]; then
  OPENCLAW_PATH="$(npm bin -g 2>/dev/null)/openclaw"
fi

VERSION_RAW="$(openclaw --version 2>/dev/null || true)"
VERSION="${VERSION_RAW:-unknown}"

rm -f "$PARTIAL_MARKER_FILE" 2>/dev/null || true
emit_telemetry "success" "installed"

success "Installed OpenClaw ${VERSION} at ${OPENCLAW_PATH}."
success "Next step: openclaw status"

rm -rf "$TMP_DIR" >/dev/null 2>&1 || true
exit 0
