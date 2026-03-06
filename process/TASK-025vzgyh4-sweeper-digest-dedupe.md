# QA Bundle — task-1772802018782-025vzgyh4

## Summary
Sweeper Digest notifications were being re-sent repeatedly when the underlying violation set was unchanged, especially across reflectt-node restarts/cold starts.

This change persists sweeper-digest suppression across restarts using the existing `SuppressionLedger` (SQLite), keyed by a *stable digest fingerprint* (violation `type + taskId` set) with a **2h** suppression window.

## Before / After
**Before:** identical `Sweeper Digest` messages could re-post after a process restart (in-memory suppression resets), causing rapid repeated notifications for the same open issue.

**After:** the same digest fingerprint is suppressed for **2h** even if the server restarts; a digest is only re-emitted once the suppression window elapses *or* the violation set meaningfully changes.

## What changed
- `src/executionSweeper.ts`
  - Added persistent suppression for sweeper digests using `SuppressionLedger(2h)`.
  - Dedupe input uses `content: fp=<digestFingerprint>` so the ledger key does not churn due to changing fields like `age_minutes`.
- `tests/sweeper-digest-dedupe.test.ts`
  - Clears `suppression_ledger` between tests to avoid leakage.
  - Adds regression test simulating a restart by clearing in-memory fingerprint cache and asserting the digest still suppresses (ledger persists).

## Proof
- `npm test`

## Caveats / Notes
- Uses existing `suppression_ledger` table; no migrations required.
- Suppression window: **2 hours** (matches existing digest suppression intent).

## Review Packet (for validating)
```json
{
  "task_id": "task-1772802018782-025vzgyh4",
  "pr_url": "https://github.com/reflectt/reflectt-node/pull/696",
  "commit": "5e089ef",
  "changed_files": [
    "src/executionSweeper.ts",
    "tests/sweeper-digest-dedupe.test.ts"
  ],
  "artifact_path": "process/TASK-025vzgyh4-sweeper-digest-dedupe.md",
  "caveats": [
    "Suppression is keyed by digest fingerprint (type+taskId set); if violation set changes, a new digest can emit immediately."
  ]
}
```
