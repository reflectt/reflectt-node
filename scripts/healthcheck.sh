#!/usr/bin/env bash

# reflectt-node healthcheck
#
# Goal: a quick green/red answer for a local dev/prod-ish environment.
# - Exit 0 when all required checks pass.
# - Exit 1 when any required check fails.
#
# Usage:
#   ./scripts/healthcheck.sh            # fast checks
#   ./scripts/healthcheck.sh --deep     # includes npm build + tests
#   REFLECTT_NODE_URL=http://127.0.0.1:4445 ./scripts/healthcheck.sh

set -u

DEEP=0
JSON=0
NO_COLOR=0

usage() {
  cat <<'EOF'
Usage: ./scripts/healthcheck.sh [--deep] [--json] [--no-color]

Checks:
  - required binaries (node, npm, git, curl)
  - reflectt-node HTTP health endpoint (default: http://127.0.0.1:4445)
  - basic repo sanity (.env presence is a warning)

Options:
  --deep       Run slower checks (npm run build + npm test)
  --json       Print a JSON summary as the last line
  --no-color   Disable ANSI colors
  -h, --help   Show this help

Env:
  REFLECTT_NODE_URL   Base URL for reflectt-node (default: http://127.0.0.1:4445)
EOF
}

while [[ ${1:-} != "" ]]; do
  case "$1" in
    --deep) DEEP=1 ;;
    --json) JSON=1 ;;
    --no-color) NO_COLOR=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; echo; usage; exit 2 ;;
  esac
  shift
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REFLECTT_NODE_URL="${REFLECTT_NODE_URL:-http://127.0.0.1:4445}"

# --- output helpers ---
if [[ $NO_COLOR -eq 0 ]] && [[ -t 1 ]] && command -v tput >/dev/null 2>&1; then
  C_RED="$(tput setaf 1)"
  C_GREEN="$(tput setaf 2)"
  C_YELLOW="$(tput setaf 3)"
  C_DIM="$(tput dim)"
  C_RESET="$(tput sgr0)"
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_DIM=""; C_RESET=""
fi

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
FAIL_MESSAGES=()
WARN_MESSAGES=()

pass() {
  echo "${C_GREEN}[PASS]${C_RESET} $*"
  PASS_COUNT=$((PASS_COUNT + 1))
}

warn() {
  echo "${C_YELLOW}[WARN]${C_RESET} $*"
  WARN_COUNT=$((WARN_COUNT + 1))
  WARN_MESSAGES+=("$*")
}

fail() {
  echo "${C_RED}[FAIL]${C_RESET} $*"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAIL_MESSAGES+=("$*")
}

have() {
  command -v "$1" >/dev/null 2>&1
}

check_cmd() {
  local bin="$1"
  if have "$bin"; then
    pass "Found $bin"
  else
    fail "Missing required binary: $bin"
  fi
}

# --- checks ---
echo "reflectt-node healthcheck"
echo "  repo: ${C_DIM}${ROOT_DIR}${C_RESET}"
echo "  url:  ${C_DIM}${REFLECTT_NODE_URL}${C_RESET}"

# Repo sanity
if [[ -f "$ROOT_DIR/package.json" ]]; then
  if grep -q '"name"\s*:\s*"reflectt-node"' "$ROOT_DIR/package.json"; then
    pass "Repo looks like reflectt-node"
  else
    warn "package.json exists but name is not reflectt-node (continuing)"
  fi
else
  fail "package.json not found at repo root (${ROOT_DIR})"
fi

if [[ -f "$ROOT_DIR/.env" ]]; then
  pass ".env present"
else
  warn ".env missing (ok for many dev flows; copy from .env.example if needed)"
fi

# Required binaries
check_cmd node
check_cmd npm
check_cmd git
check_cmd curl

# Optional binaries
if have openclaw; then
  pass "Found openclaw"
else
  warn "openclaw not found on PATH (skipping gateway status check)"
fi

if have gh; then
  pass "Found gh (GitHub CLI)"
else
  warn "gh not found on PATH (skipping GitHub auth sanity)"
fi

# reflectt-node HTTP check
if have curl; then
  HEALTH_JSON="$(curl -fsS --max-time 2 "${REFLECTT_NODE_URL}/health" 2>/dev/null || true)"
  if [[ -n "$HEALTH_JSON" ]] && echo "$HEALTH_JSON" | grep -q '"status"\s*:\s*"ok"'; then
    pass "reflectt-node /health reports ok"
  else
    fail "reflectt-node not healthy/reachable at ${REFLECTT_NODE_URL} (GET /health)"
  fi

  CAPS_JSON="$(curl -fsS --max-time 2 "${REFLECTT_NODE_URL}/capabilities?compact=true" 2>/dev/null || true)"
  if [[ -n "$CAPS_JSON" ]] && echo "$CAPS_JSON" | grep -q '"api_version"'; then
    pass "reflectt-node /capabilities reachable"
  else
    warn "Could not fetch /capabilities (may be older server or transient)"
  fi
fi

# OpenClaw status (best-effort)
if have openclaw; then
  if openclaw status >/dev/null 2>&1; then
    pass "openclaw status ok"
  else
    warn "openclaw status failed (gateway may be stopped or not configured)"
  fi
fi

# Git status cleanliness (warn-only)
if have git; then
  if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    DIRTY_COUNT="$(git -C "$ROOT_DIR" status --porcelain | wc -l | tr -d ' ')"
    if [[ "$DIRTY_COUNT" == "0" ]]; then
      pass "git working tree clean"
    else
      warn "git working tree has changes (${DIRTY_COUNT} files)"
    fi
  else
    warn "not a git work tree? (skipping git checks)"
  fi
fi

# Deep checks
if [[ $DEEP -eq 1 ]]; then
  echo
  echo "Deep checks (may take a few minutes)"

  if have npm; then
    if (cd "$ROOT_DIR" && npm run -s build >/dev/null 2>&1); then
      pass "npm run build"
    else
      fail "npm run build failed"
    fi

    if (cd "$ROOT_DIR" && npm test >/dev/null 2>&1); then
      pass "npm test"
    else
      fail "npm test failed"
    fi
  else
    fail "npm missing; cannot run deep checks"
  fi
fi

# Summary
echo
if [[ $FAIL_COUNT -eq 0 ]]; then
  echo "${C_GREEN}HEALTHCHECK: OK${C_RESET} (${PASS_COUNT} pass, ${WARN_COUNT} warn)"
else
  echo "${C_RED}HEALTHCHECK: FAIL${C_RESET} (${FAIL_COUNT} fail, ${WARN_COUNT} warn, ${PASS_COUNT} pass)"
fi

if [[ $JSON -eq 1 ]]; then
  # minimal JSON without jq dependency
  ts="$(date +%s)"
  # escape quotes in messages (best effort)
  esc() { echo "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

  printf '{"ts":%s,"ok":%s,"pass":%s,"warn":%s,"fail":%s,"reflettNodeUrl":"%s"' \
    "$ts" \
    "$([[ $FAIL_COUNT -eq 0 ]] && echo true || echo false)" \
    "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT" "$(esc "$REFLECTT_NODE_URL")"

  printf ',"warnings":['
  for i in "${!WARN_MESSAGES[@]}"; do
    [[ $i -gt 0 ]] && printf ','
    printf '"%s"' "$(esc "${WARN_MESSAGES[$i]}")"
  done
  printf '],"failures":['
  for i in "${!FAIL_MESSAGES[@]}"; do
    [[ $i -gt 0 ]] && printf ','
    printf '"%s"' "$(esc "${FAIL_MESSAGES[$i]}")"
  done
  printf ']}'
  echo
fi

exit $([[ $FAIL_COUNT -eq 0 ]] && echo 0 || echo 1)
