# Task: Fix stale review-SLA alerts for deleted/closed tasks
**ID:** task-1771362882812-c9rozxv2i  
**Branch:** link/task-c9rozxv2i-v2

## Root Cause
The watchdog cadence system and board health worker used raw timestamps without validation. When tasks were deleted (hard DELETE) between poll intervals, cached task lists could reference stale entries. Additionally, timestamps of 0 or impossibly old values produced alert ages like `9999m` or `Number.MAX_SAFE_INTEGER`.

## Changes

### `src/health.ts`
1. **`validateTaskTimestamp(ts, now)`** — New exported helper. Rejects: 0, negative, NaN, future (>1h ahead), impossibly old (>1 year). Returns validated timestamp or null.
2. **`verifyTaskExists(taskId)`** — New exported helper. Calls `taskManager.getTask()` to verify task still exists and is not done. Returns fresh task or null.
3. **`getStaleDoingSnapshot()`** — Now filters out deleted/done tasks via `verifyTaskExists()` and validates timestamps via `validateTaskTimestamp()`. Caps display age at 24h max.
4. **`runCadenceWatchdogTick()`** — Task timestamp validated with `validateTaskTimestamp()` (was raw Number cast). Task existence re-checked with `verifyTaskExists()` (was stale list lookup). Stale minutes capped at 24h max (was 9999 for missing timestamps).

### `src/boardHealthWorker.ts`
1. **`findStaleDoingTasks()`** — Added `verifyTaskExists()` guard and `validateTaskTimestamp()` for last-activity timestamps.
2. **`findAbandonedTasks()`** — Added `verifyTaskExists()` guard and `validateTaskTimestamp()` for both last-activity and createdAt timestamps.

### `tests/stale-sla-guards.test.ts`
- 14 unit tests covering `validateTaskTimestamp` (bounds, edge cases, type coercion) and `verifyTaskExists` (nonexistent tasks).

### `tests/api.test.ts` — Integration tests
- `verifyTaskExists` returns null after hard DELETE (full API create → delete → verify flow)
- `/health/team` staleDoing only contains tasks that still exist
- staleDoing `stale_minutes` are bounded (no impossible durations > 24h)

## Done Criteria Verification
| Criterion | Evidence |
|-----------|----------|
| SLA alert pipeline skips deleted tasks and validates current task existence | `verifyTaskExists()` called before every alert in both health.ts and boardHealthWorker.ts |
| Alert age calculation uses valid timestamp bounds and avoids impossible durations | `validateTaskTimestamp()` rejects 0/NaN/negative/future/impossibly-old; staleMin capped at 24h |
| Regression proof: stale/deleted task simulation does not emit reviewer alert | 14 unit tests + 3 integration tests pass; hard-DELETE flow verified end-to-end |

## Files Changed
- `src/health.ts` — Added 2 exported functions + applied guards in 3 locations
- `src/boardHealthWorker.ts` — Applied guards in 2 locations  
- `tests/stale-sla-guards.test.ts` — 14 new tests
- `process/TASK-c9rozxv2i-proof.md` — This artifact
