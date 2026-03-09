# TASK-hoy64vgsq — GET /tasks/:id returns 410 Gone for deleted tasks

**Task:** task-1773006018700-hoy64vgsq
**Status:** validating
**PR:** https://github.com/reflectt/reflectt-node/pull/839

## Done criteria

- [x] DELETE /tasks/:id writes tombstone record (done in #824)
- [x] JSONL audit log receives task_deleted event (done in #824)
- [x] GET /tasks/:id returns 410 Gone with tombstone metadata (not 404)
- [x] Test: delete a task, verify 410 + tombstone in response

## Changes shipped

- `src/tasks.ts`: `getTaskDeletionTombstone(inputId)` — queries `task_history` for `type='deleted'` events; exact + single-prefix match
- `src/server.ts` GET /tasks/:id: before returning 404, checks tombstone; if found returns 410 with `{ success, error, code, status, tombstone }`
- `src/server.ts` preSerialization hook: `tombstone` field passthrough added
- `tests/api.test.ts`: new 410 test; existing delete test updated (was expecting 404, now 410)

## Test results

1817 passed, 1 skipped (full suite)
