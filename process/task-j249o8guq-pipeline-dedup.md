# Task: Pipeline Task Dedup — Prevent Duplicate Tasks from Same-Cluster Insights

**Task ID:** task-1771821571352-j249o8guq  
**Commit:** 2ce3b69 (direct to main)  
**Branch:** link/task-j249o8guq  

## Problem

The insight-to-task bridge was creating duplicate tasks when multiple insights about the same topic got promoted. Each insight with a unique ID but same cluster would create its own task, resulting in 92+ duplicates (e.g., 27 artifact-visibility tasks, 5-6 reflection-origin tasks each).

Root cause: `canPromote()` only checked `insight.task_id` for idempotency. This missed cases where different insights about the same topic each had no linked task yet.

## Fix

Added `findExistingTaskForInsight()` in `src/insight-task-bridge.ts` that checks before creating:

1. **Direct insight_id match** — exact insight already has a task
2. **Exact title match** — another insight-bridge task with identical title exists
3. **Same cluster_key match** — another insight-bridge task's source insight has the same `stage::family::unit` cluster key

When a match is found:
- Links the new insight to the existing task (sets `task_id`)
- Updates insight status to `task_created`
- Increments `duplicatesSkipped` stat instead of creating a new task

## Files Changed
- `src/insight-task-bridge.ts` — +54 lines: `findExistingTaskForInsight()` + dedup check in `autoCreateTask()`
- `tests/insight-listener.test.ts` — +87/-1: 2 new dedup tests (same cluster = dedup, different cluster = allow), updated existing tests for EventBus interaction
- `tests/e2e-reflection-loop.test.ts` — +6/-6: updated assertions to account for auto-create + dedup

## Test Proof
- 750 tests passed, 17 skipped, 0 failed (44 test files)
- New tests: cluster-key dedup, different-cluster allows

## Known Caveats
- Title-based matching is exact (case-insensitive) — slight title variations won't dedup
- Cluster_key matching requires looking up source insight for each existing task (one-time scan on each auto-create)
