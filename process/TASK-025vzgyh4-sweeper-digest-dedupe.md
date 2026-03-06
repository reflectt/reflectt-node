# TASK-025vzgyh4 — Sweeper Digest dedupe/suppression (stop repeating unchanged digest)

Task: task-1772802018782-025vzgyh4
PR: https://github.com/reflectt/reflectt-node/pull/696

## Root cause

The Sweeper Digest emitter was effectively deduped only by `alert-preflight`’s in-memory idempotent-key window:

- `DEDUP_WINDOW_MS = 15m` (in `src/alert-preflight.ts`)

So if the underlying violations were unchanged, the digest would still be emitted again once that 15-minute window expired, which looks like ~4x/hour spam.

## Fix

Add digest-level suppression in `src/executionSweeper.ts`:

- Compute a stable digest fingerprint from the *set* of violations: sorted `"{type}:{taskId}"` entries.
  - Intentionally ignores `age_minutes` and titles to avoid churn.
- Maintain an in-memory map `fingerprint -> lastEmittedAt`.
- Suppress emitting the digest again within a 2 hour window (`DIGEST_SUPPRESSION_MS = 2h`) when the fingerprint is unchanged.

## Tests

Added unit tests:

- `tests/sweeper-digest-dedupe.test.ts`
  - suppresses repeated identical digests within window
  - re-emits after window elapses
  - does not suppress when the violation set changes

Local proof:

```bash
npx vitest run tests/sweeper-digest-dedupe.test.ts
```

## Notes / tradeoffs

- Suppression is in-memory (restart clears it). This is acceptable as a first reliability layer; primary goal is to stop frequent repeats while the process is running.
- If we want cross-restart dedupe later, we can persist last digest fingerprint + timestamp to data/.
