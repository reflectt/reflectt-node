# Task: task-1773617522840-q5u2sk3di — refactor(tasks): extract DONE_CRITERIA_PLACEHOLDER_RE to module level

## Artifact
PR: https://github.com/reflectt/reflectt-node/pull/1066 (pending)

## Changes
- src/server.ts:
  - Added module-level `DONE_CRITERIA_PLACEHOLDER_RE` constant after `TASK_TYPES` (line 212)
  - Removed inline `const DONE_CRITERIA_PLACEHOLDER_RE` from `checkDefinitionOfReady` function
  - Removed inline `const PLACEHOLDER_RE` from POST /tasks creator-type gate
  - Both usage sites now reference the shared constant — no behavior change

## AC
- [x] Single DONE_CRITERIA_PLACEHOLDER_RE constant defined at module level
- [x] All usage sites reference the shared constant
- [x] No behavior change — same regex pattern
