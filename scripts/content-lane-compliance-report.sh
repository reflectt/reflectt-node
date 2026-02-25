#!/bin/zsh
set -euo pipefail

# Portable wrapper — resolves the .mjs script relative to this file's location.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

REFLECTT_NODE_URL="${REFLECTT_NODE_URL:-http://127.0.0.1:4445}"
ASSIGNEE="${ASSIGNEE:-echo}"
CONTROL_TASK_ID="${CONTROL_TASK_ID:-task-1771427184904-mu356v5md}"

export REFLECTT_NODE_URL ASSIGNEE CONTROL_TASK_ID

node "${SCRIPT_DIR}/content-lane-compliance-report.mjs"
