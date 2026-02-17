# Task: Board-Health Execution Worker
**ID**: task-1771287936528-zs6emwi0d
**Branch**: link/task-zs6emwi0d
**Assignee**: link
**Reviewer**: kai

## Summary
Automated board hygiene worker with full audit trail and rollback capability. Runs on configurable interval, detects stale/abandoned tasks, applies policy actions, and emits periodic digests.

## Changes
- **New**: `src/boardHealthWorker.ts` — BoardHealthWorker class
  - Auto-block stale doing tasks (>4h no activity, configurable)
  - Suggest close for abandoned todo/blocked tasks (>24h, configurable)
  - Periodic digest emission to ops channel
  - Full audit log for every automated action
  - Rollback window (default 1h) to reverse automated decisions
  - Quiet hours support, max actions per tick rate limit, dry run mode
  - All thresholds configurable via env vars or runtime PATCH
- **Modified**: `src/server.ts` — Worker lifecycle + 6 REST endpoints
- **Modified**: `tests/modules.test.ts` — 9 new tests (185 total, all pass)
- **Modified**: `public/docs.md` — 6 new route entries (173/173 contract)

## REST Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/board-health/status` | Worker status, config, recent/rollbackable actions |
| GET | `/board-health/audit-log` | Full audit log with filters (limit, since, kind) |
| POST | `/board-health/tick` | Manual tick (?dryRun=true for preview) |
| POST | `/board-health/rollback/:actionId` | Reverse automated action within window |
| PATCH | `/board-health/config` | Runtime config update |
| POST | `/board-health/prune` | Prune old audit entries |

## Done Criteria Mapping
- ✅ Scheduled worker applies policy actions (auto-block stale doing, suggest-close)
- ✅ Digest emission on schedule (configurable interval, default 4h)
- ✅ Audit log for every automated action
- ✅ Rollback window for reversing automated decisions (default 1h)

## Test Proof
- 185 tests pass (up from 176), 1 skipped (pre-existing)
- 9 new BoardHealthWorker tests covering: status, audit-log, tick (dry-run + real), config update, rollback, prune, kind filter, unknown field rejection
- Route-docs contract: 173/173
