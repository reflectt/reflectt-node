# Task audit semantics

Reflectt-node uses **SQLite as the source of truth** for live task state.

JSONL files remain as **append-only audit streams** for debugging, migration, and offline inspection:

- `data/tasks.jsonl`
  - appends task snapshots on create/update
  - appends a **tombstone** on delete:
    - `{ id, deleted: true, deletedAt, deletedBy }`
  - guarantee: grep/debug consumers can distinguish deleted tasks from live snapshots
- `data/tasks.history.jsonl`
  - appends lifecycle events (`created`, `assigned`, `status_changed`, `commented`, `lane_transition`, `deleted`)
  - guarantee: task deletion writes a `deleted` event instead of silently erasing lifecycle history
- `data/tasks.comments.jsonl`
  - append-only task comment audit log

## Delete semantics

When `DELETE /tasks/:id` succeeds:
1. a `deleted` event is written to SQLite `task_history`
2. the same `deleted` event is appended to `tasks.history.jsonl`
3. a tombstone record is appended to `tasks.jsonl`
4. the live row is removed from SQLite `tasks`

The audit trail is intentionally retained even after the live task row is removed.

## Import / migration semantics

On one-time JSONL → SQLite import:
- task snapshot records create/update the live task row
- task tombstones (`deleted: true`) delete the live row from SQLite

This preserves append-only JSONL semantics without rehydrating deleted tasks as live rows.