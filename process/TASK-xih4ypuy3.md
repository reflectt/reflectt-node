# Task: Sweeper digest suppression + cancelled-task filtering regression coverage

**Task ID:** task-1772973048702-xih4ypuy3  
**Branch:** harmony/task-xih4ypuy3

## Summary

Added regression coverage and docs clarification around sweeper digest suppression behavior and orphan-PR filtering for cancelled tasks.

## Changes

### 1. Deterministic digest fingerprint coverage
- Added a unit-level assertion that the digest fingerprint is derived from the stable set of `type:taskId` pairs.
- Verified that churn in rendered copy (`title`, `message`, `age_minutes`) does not change the fingerprint.
- Verified that adding a new violation changes the fingerprint and therefore re-emits the digest.

### 2. Cancelled-task orphan-PR filtering regression
- Added a regression test covering cancelled tasks with either:
  - `metadata.cancel_reason`
  - `metadata.duplicate_of`
- Verified these tasks are excluded from orphan-PR findings during periodic sweep.

### 3. Semantics clarification
- Documented `DIGEST_SUPPRESSION_MS` semantics:
  - current window is 2 hours
  - fingerprint is based on violation identity, not rendered copy churn
  - suppression is process-local / in-memory and resets on restart
- Corrected orphan-PR wording in the cancelled-task scan path from “done task” to “cancelled task” in alert/log copy.

## Files Changed
- `src/executionSweeper.ts`
- `tests/sweeper-digest-dedupe.test.ts`
- `tests/execution-sweeper.test.ts`
- `docs/internal/sweeper-alert-payloads.md`

## Test Proof
- `npm test -- --run tests/sweeper-digest-dedupe.test.ts tests/execution-sweeper.test.ts`
- Result: **2 files passed, 19 tests passed**

## Known Caveats
- Digest suppression remains process-local/in-memory; restart persistence is intentionally not part of this task.
- Targeted test run still emits unrelated fixture noise from existing sweeper test setup (`artifact-mirror` / `unauthorized_approval` log lines), but the suite passes cleanly.
