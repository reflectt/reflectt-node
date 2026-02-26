# Node-Side context_sync Command Handler

**Task:** task-1772138165361-jn4zd2yux
**PR:** reflectt-node #420 (merged, merge-when-green)

## What
Completes the Sync Now button loop (cloud PR #219 → node PR #420):
1. User clicks Sync Now → cloud queues `context_sync` command
2. Node polls `GET /api/hosts/:hostId/commands?status=pending`
3. Node fetches local context via `/context/inject/:agent`
4. Node POSTs snapshot to cloud `/api/hosts/:hostId/context/sync`
5. Node acks command as completed (or failed)

## Implementation
- `cloudGet()` — authenticated GET helper (reuses host credential)
- `pollAndProcessCommands()` — adaptive interval (10s active, 60s idle), piggybacks on heartbeat timer
- `handleContextSync()` — fetch local → push cloud → ack lifecycle
- Unknown commands auto-completed to prevent queue pile-up
- Error handling: ack as failed + log, circuit breaker on poll errors

## Changes
- `src/cloud.ts` — +151 lines

## Proof
- CI: all 8 checks green, auto-merged via merge-when-green
- Live proof pending node restart with updated code
