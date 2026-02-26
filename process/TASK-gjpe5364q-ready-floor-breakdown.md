# TASK-gjpe5364q — Ready-floor breakdown in board-health

## Summary
Board-health digest and warnings now include per-agent ready-floor breakdown showing todoCount, unblockedTodoCount, excludedCount, and capped excluded task list with blocked_by references.

## Changes
1. **Digest**: Per-agent breakdown section with ✅/⚠️ indicators, counts, and excluded tasks (capped at 5)
2. **Warning messages**: Include todoTotal/unblockedTodo/doing inline + excluded task list
3. **API**: `/tasks/board-health` returns `unblockedTodo`, `excludedTodoCount`, `excludedTodos[]` per agent
4. **Type**: New `AgentReadyFloorBreakdown` interface, `BoardHealthDigest.readyFloorBreakdown?`

## Files
- `src/boardHealthWorker.ts` (+80 lines)
- `src/server.ts` (+37 lines)

## Checks
- `tsc --noEmit` clean
