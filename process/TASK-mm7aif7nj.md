# Task: task-1773622427927-mm7aif7nj — filter approval cards to human-only

## PR
https://github.com/reflectt/reflectt-node/pull/1071 (pending)

## Root Cause
When any task enters `validating`, the approval card emitter fires unconditionally.
Agent-to-agent reviews (e.g. pixel reviewing kotlin's PR) leak to the canvas as
approval cards that Ryan sees — confusing and noisy.

## Fix
- KNOWN_AGENT_IDS set: link, kai, pixel, sage, scout, echo, rhythm, spark, swift, kotlin, harmony
- If `task.reviewer` matches a known agent, skip the canvas card entirely
- Human reviewers (ryan, admin, empty) still get approval cards
- Agent reviews still logged for debugging

## Tests
- tests/approval-card-filter.test.ts — 4 tests: human reviewers shown, agent reviewers hidden,
  case-insensitive, whitespace trimmed
