# /health/backlog proof bundle

## 1) Breach evidence
Controlled breach was induced by creating temporary task `task-1771438459787-6q4nq7cyd` with:
- `assignee: kai`
- `status: doing`

Captured payload is stored at `artifacts/health-backlog-breach-sample.json` and shows:
- `summary.breachedLaneCount = 1`
- `summary.overallStatus = "breach"`
- `operations.compliance.status = "breach"`
- `operations.compliance.floorBreaches[0] = { agent: "kai", ready: 0, required: 1, deficit: 1 }`

Temporary task was deleted immediately after capture.

## 2) Code location
Endpoint: `src/server.ts:1599-1736`

## 3) DoR parity (`todo + required fields + unblocked`)
- Required fields gate: `src/server.ts:1621-1628`
- Ready filter: `src/server.ts:1640-1642`
- Not-ready reasons and counters: `src/server.ts:1674-1694`
- Summary includes `totalNotReady`: `src/server.ts:1701-1726`

## 4) Script disposition
Tracked wrapper script: `scripts/backlog-health.sh`
- Calls `/health/backlog`
- Pretty-prints summary/lanes via `jq` when available
