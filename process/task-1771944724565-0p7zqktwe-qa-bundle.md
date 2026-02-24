# QA Bundle: task-1771944724565-0p7zqktwe

## Summary
Integration tests for real `runMigrations()` code path — closes the gap where
local test helpers could drift from production migration code.

## Root Cause
Existing schema migration tests used local `applyMigration9()`/`applyMigration11()`
helpers that duplicated the migration SQL. If `runMigrations()` in `src/db.ts`
changed, these tests would still pass. The real code path was untested.

## Evidence Validated
- ins-1771944724516-d3dbxwwxg: "Migration v9+v11 used IF NOT EXISTS but no test
  verified the column actually existed post-migration" → now tested via real
  `runMigrations()` call on pre-v8 DBs
- "Prior failure mode: no such column task_id at runtime after upgrade" → regression
  test confirms UPDATE task_id fails before migration, succeeds after

## Changes
- `src/db.ts`: Export `runMigrations()` (was private)
- `tests/schema-migration.test.ts`: 5 new integration tests

## Test Results
- 880 tests pass (53 files)
- Schema migration: 10 tests (5 unit + 5 integration)
