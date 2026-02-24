#!/bin/zsh
set -euo pipefail

REFLECTT_NODE_URL="${REFLECTT_NODE_URL:-http://127.0.0.1:4445}"
ASSIGNEE="${ASSIGNEE:-echo}"
CONTROL_TASK_ID="${CONTROL_TASK_ID:-task-1771427184904-mu356v5md}"

export REFLECTT_NODE_URL ASSIGNEE CONTROL_TASK_ID

/opt/homebrew/bin/node "/Users/ryan/.openclaw/workspace-echo/scripts/content-lane-compliance-report.mjs"
