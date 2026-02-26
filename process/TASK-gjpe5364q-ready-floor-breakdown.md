# Task gjpe5364q — Ready-Floor Breakdown in Digest

## Summary
Added diagnostic breakdown to ready-floor alerts and board-health API.

## PR
- reflectt/reflectt-node PR #425 (`83382c0`) — merged

## Changes
| File | Change |
|------|--------|
| `src/boardHealthWorker.ts` | Digest includes todo/unblocked/blocked counts + capped blocked task list |
| `src/server.ts` | board-health API adds `todoUnblocked`, `todoBlocked`, `blockedTasks[]` per agent |

## Digest Format (after)
```
⚠️ Ready-queue floor: @link has 1/2 unblocked todo tasks (need 1 more)...
  📊 todo=3, unblocked=1, blocked=2
  • task-abc (Some blocked task) — blocked_by: task-xyz
```

## Tests
97 test files pass, 1416 tests green.
