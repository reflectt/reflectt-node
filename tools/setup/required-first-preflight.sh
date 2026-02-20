#!/usr/bin/env bash
set -euo pipefail

LOCAL_TIMEOUT=45
NETWORK_TIMEOUT=90
GLOBAL_BUDGET=300
START_TS=$(date +%s)

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

check_budget() {
  local now
  now=$(date +%s)
  local elapsed=$((now - START_TS))
  if [[ "$elapsed" -gt "$GLOBAL_BUDGET" ]]; then
    state_fail "RUNTIME_BUDGET_EXCEEDED" "openclaw status"
  fi
}

run_network_check() {
  local ref="$1"
  local cmd="$2"
  local next_cmd="$3"

  local attempt=0
  local out=""
  while [[ "$attempt" -le 2 ]]; do
    check_budget
    set +e
    out=$(timeout "$NETWORK_TIMEOUT" bash -lc "$cmd" 2>&1)
    code=$?
    set -e

    if [[ "$code" -eq 0 ]]; then
      state_pass "$ref"
      return 0
    fi

    if echo "$out" | grep -Eiq "auth|unauthorized|forbidden|invalid schema|schema"; then
      state_fail "$ref" "$next_cmd"
    fi

    if [[ "$attempt" -eq 0 ]]; then
      sleep 2
    elif [[ "$attempt" -eq 1 ]]; then
      sleep 5
    else
      state_fail "$ref" "$next_cmd"
    fi
    attempt=$((attempt + 1))
  done
}

# R0
check_budget
if timeout "$LOCAL_TIMEOUT" bash -lc "command -v bash >/dev/null && command -v curl >/dev/null"; then
  state_pass "R0_INIT"
else
  state_fail "R0_INIT" "xcode-select --install"
fi

# R1
check_budget
if timeout "$LOCAL_TIMEOUT" bash -lc "command -v openclaw >/dev/null"; then
  state_pass "R1_CLI_READY"
else
  state_fail "R1_CLI_READY" "npm i -g openclaw && openclaw --help"
fi

# R2
check_budget
if timeout "$LOCAL_TIMEOUT" bash -lc "test -d . && test -f AGENTS.md && test -f SOUL.md && test -f MEMORY.md"; then
  state_pass "R2_WORKSPACE_READY"
else
  state_fail "R2_WORKSPACE_READY" "openclaw init"
fi

# R3
run_network_check "R3_AUTH_READY" "openclaw status >/dev/null" "openclaw status"

# R4
run_network_check "R4_CHANNEL_READY" "openclaw status | grep -Eiq 'channel|reflectt|telegram|discord|signal|slack|whatsapp|imessage'" "openclaw status"

# R5
run_network_check "R5_GATEWAY_HEALTHY" "openclaw status | grep -Eiq 'gateway|running|healthy|online'" "openclaw gateway restart"

# R6
run_network_check "R6_NODE_CONNECTED" "openclaw status | grep -Eiq 'node|connected|paired|online'" "openclaw status"

echo "✅ PRECHECK_DONE (R0_INIT → R6_NODE_CONNECTED)"
echo "next: ./tools/setup/required-first-smoke.sh --channel task-comments --mention @link"
