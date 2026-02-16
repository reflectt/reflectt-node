# TASK task-1771207124518-zc94lxf37 — SQLite sync ledger for cloud coordination

## Shipped
Added a SQLite-backed `sync_ledger` (migration v2) and wired cloud task sync to use ledger-driven incremental pushes instead of placeholder/no-op behavior.

## What changed

### 1) SQLite migration v2: sync ledger schema
- Updated `src/db.ts` migrations with **version 2**.
- Added `sync_ledger` table:
  - `record_type` (TEXT)
  - `record_id` (TEXT)
  - `local_updated_at` (INTEGER)
  - `cloud_synced_at` (INTEGER, nullable)
  - `sync_status` (TEXT, default `pending`)
  - `attempt_count` (INTEGER)
  - `last_error` (TEXT)
  - composite primary key: `(record_type, record_id)`
- Added indexes on `sync_status` and `local_updated_at`.
- Added backfill for task rows (`INSERT OR IGNORE ... SELECT FROM tasks`).
- Added task table triggers for future native task-table writes (`insert`, `update`, `delete`) to keep ledger in sync.

### 2) Cloud sync now uses incremental ledger flow
- Updated `src/cloud.ts`:
  - Added ledger refresh from current task snapshot (`refreshTaskLedger`)
  - Reads dirty records from `sync_ledger` (`getDirtyTaskLedgerRows`)
  - Sends only dirty tasks to `POST /api/hosts/:id/tasks/sync`
  - Marks rows synced on success (`markTaskRowsSynced`)
  - Marks rows errored with retry metadata on failure (`markTaskRowsErrored`)
- This replaces the prior no-op `syncTasks()` behavior with real incremental sync.

### 3) DB status + test coverage
- Fixed `src/server.ts` DB table listing filter (`NOT GLOB '_*'`) so table counts reliably include non-internal tables.
- Added API tests in `tests/api.test.ts` for:
  - schema v2 presence with `sync_ledger` visible in `/db/status`
  - ledger lifecycle fields (`pending -> synced`, `attempt_count`, `cloud_synced_at`)

### 4) Docs
- Updated `public/docs.md` `GET /db/status` description to call out `sync_ledger` visibility.

## Validation
- `npm run build` ✅
- `npx vitest run tests/api.test.ts -t "SQLite sync ledger|GET /cloud/status returns cloud state"` ✅

## PR
- (to be added)
