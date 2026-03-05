#!/usr/bin/env bash
set -euo pipefail

# Preflight: read last N messages from #general before ANY ops action (restart/deploy/release).
#
# Usage:
#   scripts/chat-preflight-general.sh            # last 20 general messages
#   LIMIT=40 scripts/chat-preflight-general.sh   # last 40
#   CHANNEL=task-notifications scripts/chat-preflight-general.sh
#
# Config:
#   REFLECTT_NODE_URL (default http://127.0.0.1:4445)
#
# Exit code is always 0 (this is informational). For hard blocking, wire it into the ops command.

REFLECTT_NODE_URL=${REFLECTT_NODE_URL:-http://127.0.0.1:4445}
CHANNEL=${CHANNEL:-general}
LIMIT=${LIMIT:-20}

json=$(curl -fsS "${REFLECTT_NODE_URL}/chat/messages?channel=${CHANNEL}&limit=${LIMIT}&compact=true")

node - <<'NODE'
const data = JSON.parse(process.env.JSON_IN);
const messages = data.messages || [];

function fmtTs(ms){
  const d = new Date(ms);
  // Local time; readable, seconds omitted.
  return d.toLocaleString(undefined, { hour12: false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

const kw = /(restart|redeploy|deploy|release|live\b|receipt|merged|commit|sha|rolled back|rollback)/i;

for (const m of messages) {
  const ts = m.ts ? fmtTs(m.ts) : '??';
  const from = m.from || 'unknown';
  const firstLine = (m.content || '').split('\n')[0].slice(0, 160);
  const flag = kw.test(m.content || '') ? 'OPS?' : '    ';
  process.stdout.write(`${flag} [${ts}] ${from}: ${firstLine}\n`);
}

process.stdout.write(`\nTip: if you see a restart/deploy receipt above, do NOT repeat the action.\n`);
NODE
