# task-1771218962678-d22xbsghe — Runtime Truth Card v1 (2026-02-16)

## Shipped
Implemented a canonical environment state panel for reflectt-node dashboard operators.

### 1) New API endpoint
- `GET /runtime/truth` in `src/server.ts`
- Returns one snapshot payload with:
  - repo identity (`name`, `branch`, `sha`, `shortSha`, `cwd`)
  - runtime identity (`pid`, `nodeVersion`, `host`, `port`, `uptimeSec`, `startedAt`)
  - ports (`api`, `dashboard`)
  - cloud status (`configured`, `registered`, `hostId`, `heartbeatCount`, etc)
  - deploy drift status (`stale`, reasons, startup/current commit)
  - local path (`reflecttHome`)

### 2) Dashboard Runtime Truth Card panel
- Added panel to dashboard HTML in `src/dashboard.ts`:
  - title: `🧭 Runtime Truth Card`
  - count chip: `#truth-count`
  - body container: `#truth-body`
- Added v1 styling classes for compact facts grid:
  - `.truth-grid`, `.truth-item`, `.truth-label`, `.truth-value`

### 3) Frontend loader + refresh wiring
- Added `loadRuntimeTruthCard()` in `public/dashboard.js`
- Fetches `GET /runtime/truth`
- Renders canonical sections:
  - Repo
  - Runtime
  - Deploy
  - Cloud
  - Paths
- Wired into dashboard refresh cycle so card updates with other panels.

### 4) API docs update
- Added `/runtime/truth` to `public/docs.md` Cloud section.

## Validation
- `npm run -s build` ✅
- `npm run -s check:route-docs-contract` ✅
  - server routes: 114
  - docs routes: 114

## Notes
This is intentionally v1 read-only truth surface to remove environment ambiguity during ops/debug/review handoffs.
