# Runbook — Schema Migration Compatibility (Reflection/Insight Pipeline)

## Overview
reflectt-node uses SQLite with versioned migrations (`_migrations` table). Migrations are applied automatically on startup and are designed to be **forward-only** and **idempotent**.

## Key Migration: insight→task linkage

### The problem (prior failure mode)
Insights created at schema v8 had no `task_id` column. When the insight promotion pipeline tried to `UPDATE insights SET task_id = ?`, it threw a SQL error because the column didn't exist.

### The fix
- **Migration v9**: `ALTER TABLE insights ADD COLUMN task_id TEXT` (conditional — checks if column exists first)
- **Migration v11**: Duplicate safety net — same ALTER TABLE + creates `idx_insights_task_id` index
- Both migrations use PRAGMA `table_info(insights)` to check before ALTER (idempotent)

### What this means for operators
- **Upgrading from any version to current**: migrations auto-apply on startup. No manual steps needed.
- **Existing insights**: pre-migration insights get `task_id = NULL`. No data loss.
- **Mixed DB states**: if you somehow ran v9 but not v11 (or vice versa), either migration handles the gap.

## Migration compatibility expectations

| From | To | Automatic? | Data preserved? | Notes |
|------|----|-----------|----------------|-------|
| v8 (no insight task_id) | v9+ | ✅ Yes | ✅ Yes | ALTER TABLE adds column |
| v9 (has task_id) | v11 | ✅ Yes | ✅ Yes | Idempotent; adds index |
| v8 (no insight task_id) | v11 (skip v9) | ✅ Yes | ✅ Yes | v11 checks + adds column |
| Any version | Current (v12) | ✅ Yes | ✅ Yes | All migrations chain safely |

## Reflection→Insight→Task linkage chain

```
reflection.task_id  ──→  task.id
insight.task_id     ──→  task.id
insight.reflection_ids ──→ [reflection.id, ...]
```

All three link fields survive migration from any prior schema version.

## Troubleshooting

### "no such column: task_id" on insights
This means migrations haven't run. Restart reflectt-node — migrations apply automatically on startup.

### Insights exist but task_id is NULL
Normal for pre-migration insights. The promotion pipeline sets `task_id` when promoting an insight to a task. Historical insights that were never promoted will remain `task_id = NULL`.

## Test coverage
- `tests/schema-migration.test.ts` covers:
  - v8 → v9 ALTER TABLE
  - v9 → v11 idempotent re-ADD + index
  - v8 → v11 direct (skip v9)
  - Regression: promotion failure on pre-migration DB
  - Full reflection→insight→task chain across migration
