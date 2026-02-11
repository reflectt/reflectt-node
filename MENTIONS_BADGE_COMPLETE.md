# Unread Mentions Badge - Complete

## Summary
Added unread mentions tracking and dashboard endpoints for notification badges.

## Problem Solved
Ryan was missing @mentions because there was no visual indicator in the dashboard. The inbox endpoint existed but required manual checking.

## What Was Implemented

### 1. Backend Tracking ✅
- `getUnreadMentionsCount()`: Count unread mentions for an agent
- `getUnreadMentions()`: Get list of unread mentions
- Leverages existing `ackedMessageIds` tracking
- Only counts high-priority mentions (not all inbox messages)

### 2. New Endpoints ✅

**GET /inbox/:agent/unread**
Returns count of unread mentions (for badge)
```bash
GET /inbox/ryan/unread

Response:
{
  "count": 5,
  "agent": "ryan"
}
```

**GET /inbox/:agent/mentions**
Returns list of unread mentions (for dropdown/panel)
```bash
GET /inbox/ryan/mentions?limit=10

Response:
{
  "mentions": [
    {
      "id": "msg-123...",
      "from": "kai",
      "content": "@ryan check this out",
      "timestamp": 1770847028447,
      "channel": "general",
      "priority": "high",
      "reason": "mention"
    }
  ],
  "count": 5,
  "agent": "ryan"
}
```

### 3. Acknowledgment ✅
Existing ack endpoint works with new system:

**Mark individual mentions as read:**
```bash
POST /inbox/ryan/ack
{
  "messageIds": ["msg-123...", "msg-456..."]
}
```

**Mark all as read:**
```bash
POST /inbox/ryan/ack
{
  "all": true
}
```

**Mark by timestamp:**
```bash
POST /inbox/ryan/ack
{
  "timestamp": 1770847028000
}
```

## Dashboard Integration

The dashboard should:

1. **On load**: Call `/inbox/:agent/unread` to get badge count
2. **Show badge**: Display count on navbar/avatar
3. **On badge click**: Call `/inbox/:agent/mentions` to show dropdown
4. **On read**: Call `/inbox/:agent/ack` with message IDs
5. **Poll**: Refresh count every 30-60 seconds

Example React code:
```tsx
// Fetch unread count
const { data } = useQuery(['unread', agent], () => 
  fetch(`/inbox/${agent}/unread`).then(r => r.json())
)

// Show badge
<Badge count={data?.count} />

// Fetch mentions on click
const { data: mentions } = useQuery(['mentions', agent], () =>
  fetch(`/inbox/${agent}/mentions?limit=10`).then(r => r.json())
)

// Ack on dismiss
const ackMentions = (ids: string[]) => {
  fetch(`/inbox/${agent}/ack`, {
    method: 'POST',
    body: JSON.stringify({ messageIds: ids })
  })
}
```

## Testing Results

```bash
# Initial state
✅ 41 unread mentions for ryan

# Posted 3 new test mentions
✅ Link: "Hey @ryan check this out"
✅ Kai: "@ryan we need to talk about the roadmap"
✅ Echo: "Thoughts on this @ryan?"

# Acknowledgment
✅ Acked 1 message → count went from 41 to 40
✅ Acked all → count decreased
✅ Posted new mention → count increased by 1

# Endpoints
✅ GET /inbox/ryan/unread returns {count, agent}
✅ GET /inbox/ryan/mentions returns list with limit
✅ POST /inbox/ryan/ack decrements count correctly
```

## Code Changes

### Modified Files

**src/inbox.ts:**
- Added `getUnreadMentionsCount()`: Count unread mentions
- Added `getUnreadMentions()`: Get list of unread mentions
- Both methods filter by:
  - Not sender's own messages
  - Not acked
  - Mentions only (high priority)

**src/server.ts:**
- Added `GET /inbox/:agent/unread` endpoint
- Added `GET /inbox/:agent/mentions` endpoint
- Both placed after existing inbox endpoints

## Deployment

**Live:** reflectt-node:4445

**Ready for dashboard integration**
- @pixel can add notification badge
- @sage can use for user notifications

## Next Steps

1. Dashboard implements badge UI
2. Dashboard implements mentions dropdown
3. Consider adding browser notifications for new mentions
4. Consider SSE for real-time badge updates (instead of polling)
