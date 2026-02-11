# Presence & Activity System - Complete

## Summary
Enhanced presence tracking with last_active timestamps and comprehensive activity metrics for humans and agents.

## What Was Implemented

### 1. Enhanced Presence ✅
- Added `last_active` timestamp to AgentPresence (tracks real activity, not just heartbeats)
- Tracks last real activity: messages, task completions, etc.
- Auto-expires to offline after 10 minutes (unchanged)
- Humans and agents use the same system (no special cases)

### 2. Activity Metrics ✅
New `AgentActivity` interface tracks:
- `heartbeats_today`: Number of presence updates today
- `messages_today`: Messages sent today
- `tasks_completed_today`: Tasks marked done today
- `last_active`: Timestamp of last real activity
- `total_active_time_today_ms`: Total time in active sessions
- `first_seen_today`: First activity timestamp today

### 3. Daily Reset ✅
- Activity metrics reset at midnight (UTC)
- Presence state persists across resets

### 4. New Endpoints ✅
- `GET /agents/activity` - All agent activity metrics
- `GET /agents/:agent/activity` - Specific agent activity

### 5. Activity Recording ✅
Automatically tracks activity when:
- Messages posted (`POST /chat/messages`)
- Tasks completed (`PATCH /tasks/:id` with status=done)
- Presence updated (heartbeats)

## API Examples

### Get all activity
```bash
GET /agents/activity
{
  "activity": [
    {
      "agent": "link",
      "heartbeats_today": 5,
      "tasks_completed_today": 2,
      "messages_today": 8,
      "last_active": 1770846577716,
      "total_active_time_today_ms": 3600000,
      "first_seen_today": 1770846566464
    }
  ]
}
```

### Get specific agent activity
```bash
GET /agents/ryan/activity
{
  "activity": {
    "agent": "ryan",
    "heartbeats_today": 1,
    "tasks_completed_today": 0,
    "messages_today": 3,
    "last_active": 1770846566500,
    ...
  }
}
```

### Enhanced presence (now includes last_active)
```bash
GET /presence
{
  "presences": [
    {
      "agent": "ryan",
      "status": "working",
      "last_active": 1770846566500,
      "lastUpdate": 1770846566464,
      ...
    }
  ]
}
```

## Testing Results

```bash
# Presence tracking
✅ Ryan posts presence → status="working", last_active set
✅ Link posts presence → tracked separately

# Activity tracking
✅ Ryan sends message → messages_today incremented, last_active updated
✅ Link completes task → tasks_completed_today incremented
✅ Heartbeats counted per agent

# Endpoints
✅ GET /agents/activity returns all agents with metrics
✅ GET /agents/:agent/activity returns specific agent
✅ GET /presence includes last_active field
```

## Code Changes

- `src/presence.ts`:
  - Added `last_active` to AgentPresence
  - New `AgentActivity` interface
  - New `DailyActivity` internal tracking
  - Added `recordActivity()` method
  - Added `getAgentActivity()` and `getAllActivity()` methods
  - Added daily reset scheduler
  - Track session starts/ends for active time calculation

- `src/server.ts`:
  - New `GET /agents/activity` endpoint
  - New `GET /agents/:agent/activity` endpoint
  - Hook recordActivity() in POST /chat/messages
  - Hook recordActivity() in PATCH /tasks/:id when status=done

## Deployment
Live on reflectt-node:4445. Dashboard can now use these endpoints for team health widgets.
