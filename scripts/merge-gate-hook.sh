#!/usr/bin/env bash
# merge-gate-hook.sh — Claude Code PreToolUse hook for Bash
#
# Intercepts `gh pr merge` commands and checks the node's merge-gate API
# to ensure preview approval exists before allowing the merge.
#
# Install as a Claude Code PreToolUse hook (matcher: Bash) in the agent's
# settings.json or .claude/settings.json:
#
#   "hooks": {
#     "PreToolUse": [{
#       "matcher": "Bash",
#       "hooks": [{
#         "type": "command",
#         "command": "/path/to/merge-gate-hook.sh"
#       }]
#     }]
#   }
#
# Reads JSON on stdin: { "tool_name": "Bash", "tool_input": { "command": "..." } }
# Outputs JSON to block: { "decision": "block", "reason": "..." }

set -euo pipefail

# Read stdin (Claude Code hook input)
INPUT=$(cat)

# Extract the bash command
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Only gate `gh pr merge` commands
if ! echo "$COMMAND" | grep -qE '\bgh\s+pr\s+merge\b'; then
  exit 0
fi

# Extract PR number and repo from the command
PR_NUMBER=$(echo "$COMMAND" | grep -oE '\bgh\s+pr\s+merge\s+(\S+)' | awk '{print $NF}')
REPO=$(echo "$COMMAND" | grep -oE '--repo\s+(\S+)' | awk '{print $2}')

if [ -z "$PR_NUMBER" ]; then
  exit 0  # Can't parse — let it through, will fail naturally
fi

# Use NODE_API_BASE if set, otherwise default to localhost
NODE_API=${NODE_API_BASE:-http://localhost:3000}

# Check the merge gate API (route: /merge-gate/check/:owner/:repo/:prNumber)
if [ -n "$REPO" ]; then
  GATE_URL="${NODE_API}/merge-gate/check/${REPO}/${PR_NUMBER}"
else
  GATE_URL="${NODE_API}/merge-gate/check/*/*/${PR_NUMBER}"
fi

RESPONSE=$(curl -sf "$GATE_URL" 2>/dev/null || echo '{"approved":false}')
APPROVED=$(echo "$RESPONSE" | jq -r '.approved // false')

if [ "$APPROVED" = "true" ]; then
  exit 0
fi

# Block the merge
cat <<EOF
{"decision":"block","reason":"[MergeGate] PR #${PR_NUMBER} has no preview approval. A 'Looks good' message in the canvas preview thread is required before merging. Ask the team to review the preview first."}
EOF
