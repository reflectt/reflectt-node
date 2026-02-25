# Task: Test Task Pollution Fix

**Task ID:** task-1771959182464-9syvaps01  
**PR:** #342 (merged)  
**Severity:** P0  
**Agent:** link

## Problem

455+ junk tasks polluted the live task board, created by vitest integration tests hitting `localhost:4445` (the live server) instead of the isolated in-process test server. Board showed 468 todo with 224 assigned to link — all fake.

Three test files were the offenders:
- `tests/artifact-visibility.test.ts` — ~7 tasks/run
- `tests/reflection-origin-gate.test.ts` — ~4 tasks/run
- `tests/pipeline-health-merge.test.ts` — reflections → auto-promoted tasks

## Root Cause

The tests use `fetch('http://127.0.0.1:4445/...')` to hit the live running server. The temp `REFLECTT_HOME` from `tests/setup.ts` only isolates tests using `app.inject()` (the in-process Fastify test helper). HTTP requests bypass it entirely.

## Fix

1. **afterAll cleanup**: Each test file tracks created task IDs and DELETEs them in `afterAll`
2. **is_test metadata**: All created tasks include `is_test: true` (caught by harness filter from #336 as defense-in-depth)
3. **Pipeline test**: Tracks auto-promoted task IDs from reflection submissions

## Complementary Fixes (already shipped)

- PR #336: `isTestHarnessTask()` filter hides test tasks from `/tasks/next`, `/tasks`, board-health
- PR #337: Case-insensitive title matching in harness filter
- Bulk cleanup: 455 junk tasks deleted manually via DELETE API

## Verification

- All 13 live-server tests pass (not skipped)
- Board stays clean after test run (3 real tasks, 0 new junk)
- Full suite: 992 passed, 1 skipped
- Board-health: 22 total todo (was 468)

## Reflection

Filed ref-1771983194176-ta9z0h8rg → insight ins-1771983194182-eksbhkgim (score 10, auto-promoted)
