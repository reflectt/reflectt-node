# QA Bundle: task-1771907836654-txobnxkmc

## Summary
Activity signal replaces raw task.updatedAt in all enforcement paths.
New module `src/activity-signal.ts` computes `effective_activity_ts = max(last_comment_at, last_state_transition_at, task_created_at)` with source tracking and monotonic guard.

## Changes
- `src/activity-signal.ts`: getEffectiveActivity() + formatActivityWarning()
- `src/boardHealthWorker.ts`: uses getEffectiveActivity()
- `src/working-contract.ts`: uses activity signal + shows source in warnings
- `src/watchdog/idleNudgeLane.ts`: uses effectiveActivityTs field
- `docs/WATCHDOG_BEHAVIOR_EXPLAINER.md`: activity signal documentation
- `tests/activity-signal.test.ts`: 8 tests

## Test Results
- 916 tests pass (54 files)
