# Node-Side context_sync Command Handler

**Task:** task-1772138165361-jn4zd2yux
**PR:** reflectt-node #420 (merged)

## Flow

1. Dashboard user clicks **Sync Now** → cloud queues `context_sync` in `host_commands`
2. Node polls `GET /api/hosts/:hostId/commands?status=pending`
3. On `context_sync`: ack → fetch local `/context/inject/:agent` → POST to cloud `/context/sync` → complete
4. Command lifecycle: pending → acknowledged → completed (or failed)

## Implementation

- `cloudGet()` helper for authenticated GET requests
- `pollAndProcessCommands()` — adaptive interval (10s active, 60s idle), piggybacks on heartbeat
- `handleContextSync()` — local context fetch → cloud push → ack lifecycle
- Unknown commands auto-completed to prevent pile-up
- Error handling: fail + log on errors, circuit breaker on consecutive poll failures
