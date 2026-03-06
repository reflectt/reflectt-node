# Sidebar shows No agents online — fix

**Task:** task-1772654627011-b6jd1e21s
**PR:** https://github.com/reflectt/reflectt-node/pull/710

## Root Cause
Presence is in-memory only. On restart, `getAllPresence()` returns empty array. The heartbeat sends `agents=[]` to cloud, overwriting the stored agent list. Sidebar filters for `status !== 'offline'`, gets nothing.

## Fix
`PresenceManager.seedPresenceFromRecentActivity()` runs in constructor:
- Recent chat messages (last 10min) 
- Doing task assignees
- Seeds as `idle` (not `working`) — shows in sidebar, updates on interaction
- Filters system/email/empty senders

## Tests
3 regression tests in `tests/presence-seed.test.ts`. 1729/1729 pass.
