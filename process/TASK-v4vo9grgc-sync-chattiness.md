# Host→Cloud Sync Chattiness Reduction

**Task:** task-1772137749205-v4vo9grgc
**PR:** reflectt-node #419 (merged) + reflectt-cloud #220 (merged)

## Before/After — Node-Side (reflectt-node)

| Endpoint | Before | After (idle) | After (active) |
|---|---|---|---|
| POST /chat/sync | 12/min (5s) | 1/min (60s) | 12/min (5s) |
| POST /canvas | 12/min (5s) | 1/min (60s) | 12/min (5s) |
| POST /usage/sync | 4/min (15s) | 1/min (60s) | 4/min (15s) |
| POST /heartbeat | 2/min (30s) | 2/min (unchanged) | 2/min |
| POST /tasks/sync | 1/min (60s) | 1/min (unchanged) | 1/min |
| **Total** | **~31/min** | **~6/min** | **~31/min** |

## Before/After — Cloud-Side (reflectt-cloud PR #220)

| Endpoint | Before | After |
|---|---|---|
| GET /api/hosts | every 15s | every 30s |
| GET activity | every 8s | every 30s |
| POST presence | every 8s | every 30s + circuit breaker |
| GET usage | every 10s | every 30s |
| GET sidebar | every 30s | every 60s |
| Org/team cache | 30s TTL | 5 min TTL |

## Auth Fixes

- **usage/sync 401:** Fixed in cloud PR #220 — added `authenticateHostCredential` as primary auth
- **presence 404:** Mitigated with circuit breaker — stops retrying on 401/403/404

## Idle Detection (node)

- `lastActivityAt` tracked, updated on chat events
- Idle threshold: 2 min without activity
- When idle: chat/canvas/usage sync slow to 60s
- When active: burst at original intervals
- `markCloudActivity()` exported for other modules
