# TASK-7xyi88v7x — Fix task deletion audit semantics

**Task:** task-1772979825736-7xyi88v7x

## Problem
Deleting a task removed the live SQLite row but did **not** write a canonical delete audit trail:
- no `deleted` lifecycle event was guaranteed in `task_history`
- no tombstone was appended to `tasks.jsonl`
- JSONL import could not distinguish a deleted task from a stale earlier snapshot

That made grep/debug consumers vulnerable to phantom-task interpretation and left delete semantics inconsistent between SQLite and JSONL.

## Changes
### 1) Add explicit `deleted` lifecycle event
- Extended `TaskHistoryEventType` with `deleted`.
- `deleteTask()` now writes a `deleted` event into SQLite `task_history` with:
  - `deletedAt`
  - `deletedBy`
  - `previousStatus`
  - `title`
- The same event is appended to `tasks.history.jsonl`.

### 2) Append canonical tombstone to `tasks.jsonl`
On successful delete, we now append:
```json
{ "id": "task-...", "deleted": true, "deletedAt": 123, "deletedBy": "system" }
```
This gives append-only JSONL a stable “this task is deleted” record instead of relying on absence.

### 3) Preserve audit rows; remove only live task row
Delete semantics now:
- remove from live `tasks` table
- keep `task_history` / `task_comments` as audit
- append delete history JSONL
- append task tombstone JSONL

This keeps SQLite as source of truth for current state while preserving append-only audit history.

### 4) Import tombstones correctly
`importTasks()` now recognizes `{ deleted: true }` task records and deletes the live row during JSONL→SQLite import instead of rehydrating stale snapshots as active tasks.

### 5) Document semantics
Added `docs/task-audit-semantics.md` to make the contract explicit:
- SQLite = live source of truth
- JSONL = append-only audit stream
- deletes write both history + tombstone records

## Regression / correctness note
I also adjusted delete ordering so the live-row removal becomes visible immediately even if a caller forgets to `await deleteTask()`. That avoided a ready-queue test regression caused by temporarily lingering deleted tasks during async cleanup.

## Test proof
`npm test --silent`
- **1736 passed, 1 skipped**

## Files changed
- `src/tasks.ts`
- `src/types.ts`
- `tests/api.test.ts`
- `docs/task-audit-semantics.md`
- `process/TASK-7xyi88v7x.md`

## Caveats
- Delete actor is still `system` on the current HTTP delete path; if we later add authenticated task mutation actors, this can be threaded through the route cleanly.
- Deleted-task comments/history remain as audit and are not exposed as live tasks.