# TASK-1773653534615 — Canvas query timeout for agent-routed queries

## Problem
When a canvas query doesn't match deterministic patterns (tasks, hosts, revenue, onboarding), it routes to the responding agent via DM and returns an "Asking {agent}…" card. If the agent is idle, busy, or doesn't respond via canvas_push, the "Asking…" card hangs forever with no resolution.

## Root Cause
No timeout mechanism existed for the agent DM → canvas_push response path. The response depends on the agent's OpenClaw session picking up the DM and replying — which may never happen if the agent is idle or overwhelmed.

## Fix (commit 55c95d1)
- Register a temporary `eventBus.on()` listener after sending the DM
- Listener watches for `canvas_message` events with `isResponse: true` from the target agent
- After 15 seconds with no response, emit a timeout fallback card: "{agent} is busy right now. Try again in a moment, or ask a different agent."
- Listener auto-cleans up on response or timeout (no leaks)
- Session history records the timeout for continuity

## Verification
- Node restarted with new code, health=ok
- Deterministic queries (tasks, hosts) are unaffected — they don't go through the agent DM path
- General queries that hang will now resolve within 15s

## Done Criteria
- [x] General queries show timeout message after 15s if agent doesn't respond
- [x] Deterministic queries unaffected
- [x] No memory leaks from listener registration
