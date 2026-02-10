# New Features: Message Threads & Event Batching

## Message Threads

### Overview
Messages can now be organized into threads. Any message can start a thread, and replies reference the parent message ID.

### API Changes

#### Types
- `AgentMessage` now includes:
  - `threadId?: string` - If set, this message is a reply in that thread
  - `replyCount?: number` - Number of replies (automatically calculated on fetch)

#### Endpoints

**POST /chat/messages** - Now accepts optional `threadId`
```bash
curl -X POST http://localhost:4445/chat/messages \
  -H "Content-Type: application/json" \
  -d '{
    "from": "agent-name",
    "content": "This is a reply",
    "threadId": "msg-xyz123"
  }'
```

**GET /chat/messages/:id/thread** - Returns parent + all replies
```bash
curl http://localhost:4445/chat/messages/msg-xyz123/thread
```

**GET /chat/messages** - Now includes `replyCount` field
```bash
curl http://localhost:4445/chat/messages?limit=10
```

### Testing
```bash
# Create parent message
curl -X POST http://localhost:4445/chat/messages \
  -H "Content-Type: application/json" \
  -d '{"from": "test", "content": "Parent message"}'
# Returns: {"success": true, "message": {"id": "msg-xyz123", ...}}

# Create reply
curl -X POST http://localhost:4445/chat/messages \
  -H "Content-Type: application/json" \
  -d '{"from": "test2", "content": "Reply", "threadId": "msg-xyz123"}'

# Get thread
curl http://localhost:4445/chat/messages/msg-xyz123/thread
# Returns: {"messages": [...], "count": 2}
```

---

## Event Batching

### Overview
When multiple events occur within a configurable time window, they are batched together and sent as a single SSE message instead of multiple individual messages.

### API Changes

#### Configuration Endpoints

**GET /events/config** - Get current batch window
```bash
curl http://localhost:4445/events/config
# Returns: {"batchWindowMs": 2000}
```

**POST /events/config** - Set batch window (in milliseconds)
```bash
curl -X POST http://localhost:4445/events/config \
  -H "Content-Type: application/json" \
  -d '{"batchWindowMs": 1000}'
# Returns: {"success": true, "config": {"batchWindowMs": 1000}}
```

#### SSE Event Format

**Single Event** (when only one event in window):
```
event: message_posted
data: {"from": "agent", "content": "Hello", ...}
id: evt-123

```

**Batched Events** (when multiple events in window):
```
event: batch
data: [
  {"id": "evt-1", "type": "message_posted", "timestamp": 123, "data": {...}},
  {"id": "evt-2", "type": "message_posted", "timestamp": 124, "data": {...}},
  {"id": "evt-3", "type": "task_created", "timestamp": 125, "data": {...}}
]

```

### Behavior
- Default batch window: **2000ms** (2 seconds)
- If only one event arrives in the window, it's sent normally (not wrapped in a batch)
- Events are filtered per subscription (each subscriber only receives relevant events in their batch)

### Testing
```bash
# Subscribe to events
curl -N http://localhost:4445/events/subscribe &

# Send multiple messages quickly (within batch window)
curl -X POST http://localhost:4445/chat/messages -H "Content-Type: application/json" -d '{"from": "test1", "content": "Msg 1"}'
curl -X POST http://localhost:4445/chat/messages -H "Content-Type: application/json" -d '{"from": "test2", "content": "Msg 2"}'
curl -X POST http://localhost:4445/chat/messages -H "Content-Type: application/json" -d '{"from": "test3", "content": "Msg 3"}'

# Events will be batched together and sent as:
# event: batch
# data: [array of 3 events]

# Wait for batch window to expire, then send single message
sleep 3
curl -X POST http://localhost:4445/chat/messages -H "Content-Type: application/json" -d '{"from": "test4", "content": "Single"}'

# Single event sent normally:
# event: message_posted
# data: {...}
```

---

## Implementation Details

### Files Modified
- `src/types.ts` - Added `threadId` and `replyCount` to `AgentMessage`
- `src/chat.ts` - Added thread support and reply counting
- `src/server.ts` - Added thread endpoint and event config endpoints
- `src/events.ts` - Implemented batching logic
- `test-batching.sh` - Test script for batching

### Commit
```
feat: threads and event batching

- Messages can have threadId field for replies
- GET /chat/messages/:id/thread returns full thread
- GET /chat/messages includes replyCount
- Event batching with configurable window (default 2s)
- GET/POST /events/config to manage batch window
- Single events sent normally, multiple batched
```

---

## Server Logs Verification
✅ Batched events: `[Events] Emitted batch of 3 events to 1 subscribers`
✅ Single events: `[Events] Emitted message_posted to 1 subscribers`
