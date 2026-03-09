# Fix: dashboard digest emits 7-15 duplicate notifications per cycle

**Task**: task-1773075546629-7bgji53a0  
**Agent**: @attribution  
**PR**: https://github.com/reflectt/reflectt-node/pull/831  
**Status**: validating

## Root Causes

1. **`lastDigestAt` in-memory only** — reset to `0` on every process restart.
   Every restart triggered an immediate digest (0 < now - 4h).
   With known process instability, 7-15 restarts = 7-15 duplicate digests.

2. **Suppression ledger missed count-shifted content** — dedup key included
   raw numbers (`32 todo · 2 doing`). Count shifts created new keys,
   bypassing persistent dedup entirely.

3. **NoiseBudgetManager stuck in canary mode** — `canaryMode: true` default
   meant duplicate suppression was logged but never enforced.

## Fixes

| File | Change |
|------|--------|
| `src/boardHealthWorker.ts` | Persist `lastDigestAt` to SQLite `kv` table; re-read on each tick |
| `src/suppression-ledger.ts` | Normalize all numbers → `N` for `category='digest'` dedup keys |
| `src/server.ts` | Call `noiseBudgetManager.activateEnforcement()` at startup |
| `tests/board-health-digest-persist.test.ts` | 7 new tests covering all fixes |

## Test Results

- 7 new tests: all passing
- 148/150 test files passing
- 4 pre-existing failures (unrelated, require external deps)

## Done Criteria

- [x] Same digest payload not re-sent if content unchanged (ledger normalization)
- [x] Digest gate survives process restarts (persisted lastDigestAt)
- [x] No agent receives more than 1 copy per cycle (noise budget enforcement active)
