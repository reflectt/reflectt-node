# QA Bundle: Shared Workspace Contract

**Task:** task-1771910208817-uomrt5ooi
**PR:** https://github.com/reflectt/reflectt-node/pull/318
**Commit:** df9c9c0
**Branch:** link/task-uomrt5ooi
**Reviewer:** sage

## Problem
`SHARED_WORKSPACE()` default resolved to `../workspace-shared` relative to project root (via `resolve(cwd(), '..', 'workspace-shared')`). When running from `reflectt-node/`, this resolved to `/Users/ryan/.openclaw/workspace-link/workspace-shared` — NOT the canonical `/Users/ryan/.openclaw/workspace-shared`. Artifacts were being mirrored to the wrong location.

## Fix
Default now uses `resolve(homedir(), '.openclaw', 'workspace-shared')` — always resolves to the canonical `~/.openclaw/workspace-shared` regardless of working directory.

## Changed Files
- `src/artifact-mirror.ts` — Import `homedir()`, update `getSharedWorkspace()` default, add JSDoc
- `tests/artifact-mirror.test.ts` — 5 new tests covering canonical path + readiness + integration
- `docs/shared-workspace.md` — Canonical path docs, env override, migration note

## Test Proof
928 tests passing (5 new in `Shared Workspace Canonical Path` describe block):
1. defaults to ~/.openclaw/workspace-shared when REFLECTT_SHARED_WORKSPACE is unset
2. respects REFLECTT_SHARED_WORKSPACE override
3. isSharedWorkspaceReady returns true when directory exists
4. isSharedWorkspaceReady returns false when directory missing
5. mirrorArtifacts writes to the canonical shared workspace path

## Caveats
- Existing artifacts mirrored to the old wrong path (`workspace-link/workspace-shared/process/`) are not auto-migrated — they can be manually moved or will accumulate naturally under the correct path going forward.
