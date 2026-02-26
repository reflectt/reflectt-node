# Task dfoqhaj1g — SlotManager.subscribe for Canvas Activity Detection

## Summary
Added subscribe API to SlotManager and wired it to markCloudActivity() so canvas slot updates trigger burst-mode adaptive sync.

## PR
- reflectt/reflectt-node PR #424 (`7e60a2d`) — merged

## Changes
| File | Change |
|------|--------|
| `src/canvas-slots.ts` | Added `subscribe(callback)`, `notifySubscribers()`, `subscribers` Set |
| `src/cloud.ts` | Wired `slotManager.subscribe(() => markCloudActivity())` |

## Pattern Match
Follows exact same pattern as chatManager and taskManager subscribers:
```typescript
// chat.ts
subscribe(callback: (message: AgentMessage) => void) {
  this.subscribers.add(callback)
  return () => this.subscribers.delete(callback)
}

// canvas-slots.ts (new)
subscribe(callback: SlotSubscriber): () => void {
  this.subscribers.add(callback)
  return () => this.subscribers.delete(callback)
}
```

## Testing
- 97 test files pass, 1416 tests green
- `tsc --noEmit` clean
- All CI checks pass (test, gitleaks, lane-reason, task-linkify)
