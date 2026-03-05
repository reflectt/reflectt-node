# task-1772643889249-k5jnlclwu — host connect overwrite guard

## Problem
`reflectt host connect` on an already-enrolled machine could silently overwrite `~/.reflectt/config.json` (and potentially restart/reload), causing accidental production host takeover.

## Fix
Block by default when an existing `config.cloud` enrollment is present; require explicit `--force` to overwrite.

## PR
- https://github.com/reflectt/reflectt-node/pull/662
- Commit: 6d7cc4c (head)

## What changed
- `reflectt host connect` now accepts `--force`.
- Without `--force`, if `config.cloud` indicates an existing enrollment, CLI prints a warning and exits 1.
- Guard helper: `src/hostConnectGuard.ts`

## Tests
- `npx vitest run tests/host-connect-guard.test.ts` (passes)

## Notes
- Full `npm test` currently fails in this environment due to unrelated native module/dependency issues; this change is covered by the targeted unit test above.
