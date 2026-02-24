# task-1771951483824-rksr5cj37 — Shared Workspace Read API + Artifact Preview

**PR:** https://github.com/reflectt/reflectt-node/pull/332  
**Author:** link  
**Reviewer:** sage  
**Date:** 2026-02-24

## What shipped

This implements a safe, read-only HTTP API for accessing mirrored artifacts in the canonical shared workspace:

- Default shared workspace root: `~/.openclaw/workspace-shared`
- Override: `REFLECTT_SHARED_WORKSPACE=/path/to/workspace-shared`
- Allowlisted prefix: `process/` (v1 only)
- Allowlisted extensions: `.md .txt .json .log .yml .yaml`
- Size cap: 400KB

Also extends task artifact resolution to fall back to the shared workspace (and optionally include preview/content).

## Endpoints

### Shared workspace

- `GET /shared/list?path=process/&limit=200`
  - Lists directories/files under shared workspace.
  - Filters disallowed extensions.
  - Uses `lstat` to detect symlinks and **skips** symlinks whose targets escape the shared root.

- `GET /shared/read?path=process/TASK-...md`
  - Reads file content (400KB cap).
  - `include=preview&maxChars=2000` returns a truncated preview.

- `GET /shared/view?path=process/TASK-...md`
  - HTML viewer for shared artifacts.

### Task artifacts

- `GET /tasks/:id/artifacts`
  - Resolves artifact refs from task metadata (`artifact_path`, `artifacts[]`, QA bundle, review handoff).
  - For file paths: checks repo workspace first, then shared workspace fallback.
  - Query: `include=preview` or `include=content`.

## Security invariants

Path validation for shared-workspace reads/lists:

1. Reject absolute paths + Windows drive letters.
2. Reject any `..` segments before normalization.
3. Enforce allowlisted prefixes (`process/`).
4. **realpath containment:** resolved real path must remain under shared workspace root realpath (defeats symlink escape).
5. Extension allowlist.
6. Size cap.

## Tests / proof

- Unit tests: `tests/shared-workspace-api.test.ts` (41 tests)
- HTTP integration tests: added to `tests/api.test.ts` under `describe('Shared Workspace Read API (HTTP)')`
- Full suite:
  - `npm test --silent` → **985 passed**, 1 skipped

## Notes / caveats

- API is read-only; it does not expose a write surface into the shared workspace.
- v1 allowlist is **process/** only; we can expand to `public/` later if needed.
- `resolveTaskArtifact()` prefers workspace-local files; shared workspace is fallback.
