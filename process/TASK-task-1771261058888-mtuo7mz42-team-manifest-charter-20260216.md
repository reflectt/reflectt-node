# TASK task-1771261058888-mtuo7mz42 — TEAM.md charter + `/team/manifest` API (data-dir model)

## Scope pivot applied
Implemented per architecture decision: TEAM charter is loaded from `~/.reflectt/TEAM.md` (via `REFLECTT_HOME`) instead of repo-root files.

## What shipped in code

### 1) `/team/manifest` now serves data-dir TEAM.md
- Endpoint reads from: `join(REFLECTT_HOME, 'TEAM.md')`
- Returns:
  - `raw_markdown`
  - `sections` (parsed markdown headings/content)
  - `version` (sha256 content hash)
  - `updated_at` (mtime)
  - `path`, `relative_path`, `source`
- 404 response includes actionable hint when file is missing.

### 2) Parsed structured sections for agent consumption
- Added markdown section parser in server path.
- Supports heading-based extraction (`#..######`) into structured blocks.

### 3) API tests updated
- Added/updated `Team Manifest` integration test to:
  - write fixture to `join(REFLECTT_HOME, 'TEAM.md')`
  - verify raw + structured + version metadata response contract.

## Files changed
- `src/server.ts`
- `tests/api.test.ts`

## Verification
Command:
```bash
npm test -- --run tests/api.test.ts -t "Team Manifest"
```
Result:
- `Test Files: 1 passed`
- `Tests: 1 passed, 82 skipped`
- Exit code `0`

## Notes
- This aligns with multi-team architecture: product code remains generic while each team defines culture in its own `~/.reflectt/TEAM.md`.
