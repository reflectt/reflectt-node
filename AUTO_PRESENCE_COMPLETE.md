# Auto-Presence Updates - Complete

## Summary
Automatic presence status updates based on activity - no manual POST /presence required.

## Problem Solved
Users had to manually update their presence status. If you're actively chatting or working on tasks, the system should infer your status automatically.

## What Was Implemented

### 1. Message Activity → "working" ✅
When you post a message, presence automatically updates to "working"

```bash
POST /chat/messages
{
  "from": "ryan",
  "content": "hello"
}

# Automatically sets:
# - presence.status = "working"
# - presence.last_active = now
# - activity.messages_today++
```

### 2. Task Creation → "working" ✅
When you create a task, you're marked as working

```bash
POST /tasks
{
  "createdBy": "kai",
  "title": "..."
}

# Automatically sets kai's presence to "working"
```

### 3. Task Status Updates → Smart Status ✅
Updating task status automatically sets appropriate presence:

| Task Status | Presence Status |
|-------------|-----------------|
| `doing` | `working` |
| `done` | `working` |
| `blocked` | `blocked` |
| `validating` | `reviewing` |

```bash
PATCH /tasks/:id
{
  "status": "blocked"
}

# If task has assignee, automatically sets their presence to "blocked"
```

### 4. Existing Manual Control Still Works ✅
You can still manually POST to `/presence/:agent` to override:

```bash
POST /presence/ryan
{
  "status": "idle",
  "task": "taking a break"
}
```

## Testing Results

```bash
# Message activity
✅ Ryan posts message → status="working", last_active updated
✅ Multiple users posting → each tracked independently

# Task activity
✅ Kai creates task → status="working"
✅ Link marks task "doing" → status="working"
✅ Link completes task → status="working"
✅ Echo marks task "blocked" → status="blocked"
✅ Echo marks task "validating" → status="reviewing"

# Auto-expiry still works
✅ 10 minutes of inactivity → auto-expires to "offline"
```

## Code Changes

### Modified Files

**src/server.ts:**

1. **POST /chat/messages:**
   - Added: `presenceManager.updatePresence(from, 'working')`
   - Effect: Posting = working status

2. **POST /tasks:**
   - Added: `presenceManager.updatePresence(createdBy, 'working')`
   - Effect: Creating tasks = working status

3. **PATCH /tasks/:id:**
   - Added status-based presence updates:
     - `status=doing` → `working`
     - `status=done` → `working` 
     - `status=blocked` → `blocked`
     - `status=validating` → `reviewing`
   - Effect: Task state changes reflect in presence

## User Experience

**Before:**
- User posts 10 messages
- Dashboard shows: "offline" (forgot to update presence)
- Confusing for team

**After:**
- User posts 10 messages
- Dashboard shows: "working" (auto-updated)
- Accurate, real-time status

## Benefits

1. **No Manual Updates**: Users don't think about presence - it just works
2. **Accurate Status**: Presence reflects actual activity
3. **Better Team Awareness**: See who's actively working in real-time
4. **Fallback to Manual**: Can still override if needed

## Edge Cases Handled

- ✅ Multiple rapid messages → only updates once (no spam)
- ✅ Auto-expiry still works → 10 min inactive = offline
- ✅ Manual overrides respected → explicit POST /presence takes priority
- ✅ No assignee on task → no presence update (safe)

## Dashboard Impact

Ryan's dashboard should now:
1. Always show his actual status when he's active
2. No need for "update presence" button
3. Status badge reflects real activity
4. Team can see who's actively working

## Deployment

**Live:** reflectt-node:4445

**No dashboard changes needed** - presence endpoint already consumed by UI, now just more accurate.

## Next Steps

Consider adding:
1. Custom status messages (e.g., "Working on X")
2. DND mode (suppress auto-updates)
3. Smart status: "coding" vs "in meeting" vs "reviewing"
