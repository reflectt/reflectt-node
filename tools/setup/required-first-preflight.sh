#!/usr/bin/env bash
set -euo pipefail

LOCAL_TIMEOUT=45
NETWORK_TIMEOUT=90
GLOBAL_BUDGET=300
START_TS=$(date +%s)
API_BASE="${API_BASE:-http://127.0.0.1:4445}"

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
    state_fail "RUNTIME_BUDGET_EXCEEDED" "npm run dev"
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
if timeout "$LOCAL_TIMEOUT" bash -lc "command -v bash >/dev/null && command -v curl >/dev/null && command -v node >/dev/null && command -v npm >/dev/null"; then
  state_pass "R0_INIT"
else
  state_fail "R0_INIT" "install Node.js 22+, then rerun this script"
fi

# R1
check_budget
if timeout "$LOCAL_TIMEOUT" bash -lc "test -d node_modules"; then
  state_pass "R1_DEPS_READY"
else
  state_fail "R1_DEPS_READY" "npm ci"
fi

# R2
check_budget
if timeout "$LOCAL_TIMEOUT" bash -lc "test -f package.json && test -d src && test -f src/server.ts"; then
  state_pass "R2_WORKSPACE_READY"
else
  state_fail "R2_WORKSPACE_READY" "cd reflectt-node && ls"
fi

# R3
check_budget
if timeout "$LOCAL_TIMEOUT" bash -lc "npm run build >/dev/null"; then
  state_pass "R3_BUILD_READY"
else
  state_fail "R3_BUILD_READY" "npm run build"
fi

# R4
run_network_check "R4_API_HEALTHY" "curl -fsS ${API_BASE}/health >/dev/null" "npm run dev"

# R5
run_network_check "R5_TASKS_API_READY" "curl -fsS \"${API_BASE}/tasks?limit=1\" >/dev/null" "curl -s ${API_BASE}/health"

# R6
run_network_check "R6_CHAT_API_READY" "curl -fsS \"${API_BASE}/chat/channels\" >/dev/null" "curl -s ${API_BASE}/chat/channels"

echo "✅ PRECHECK_DONE (R0_INIT → R6_CHAT_API_READY)"
echo "next: ./tools/setup/required-first-smoke.sh --channel task-comments --mention @link"
