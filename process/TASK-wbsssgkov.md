# Task: task-1773582919506-wbsssgkov — fix(tasks): gate task creation on non-empty done_criteria

## Artifact
PR: https://github.com/reflectt/reflectt-node/pull/1059 (pending)

## Changes
- src/server.ts:
  - Human-created tasks (`createdBy='user'`) with empty done_criteria → 201 + warning in `warnings[]`
  - Placeholder done_criteria (`TBD`, `TODO`, etc.) → always 400 for all creators
  - Agent-created tasks (any other `createdBy`) with empty done_criteria → 400 (unchanged/reinforced)
  - Warning message: "done_criteria is empty. Add at least 1 verifiable outcome before moving to doing."
- tests/done-criteria-gate.test.ts: 4 tests (human empty→warn, agent empty→block, placeholder→block, valid→no-warn)

## AC
- [x] POST /tasks returns a warning when done_criteria is empty (human-created: 201 + warnings[])
- [x] POST /tasks returns an error when done_criteria contains only placeholder text
- [x] Existing tasks with empty done_criteria surfaced in daily digest (already in server.ts line 2401)
- [x] Agent-created tasks with empty criteria blocked at creation with clear error message
