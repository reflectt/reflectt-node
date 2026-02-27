# TASK-9nbiy8y3k — Reduce floor spam

## Summary
Added state-based debouncing and snapshot timestamps to ready-floor alerts, reducing noise from repeated identical alerts.

## Before
```
⚠️ Ready-queue floor: @link has 0/2 unblocked todo tasks (need 2 more).
  📊 todo=0 (all unblocked), doing=1
```
Repeats every 30m cooldown even if nothing changed.

## After
```
⚠️ Ready-queue floor: @link has 0/2 unblocked todo tasks (need 2 more).
  🕐 Snapshot: 21:30:45 UTC (30m since last alert)
  📊 todo=0 (all unblocked), doing=1
```
- Suppressed if readyCount unchanged AND within cooldown window
- State change (e.g., 1→0 or 0→1) triggers alert immediately regardless of cooldown
- Shows "Δ ready: 1 → 0" when state changes
- Floor recovery (readyCount >= minReady) clears debounce state so next breach alerts immediately

## Changes
- `src/boardHealthWorker.ts`:
  - Added `readyQueueLastState` tracker (previous readyCount per agent)
  - Suppress alerts when state unchanged + within cooldown
  - Include `🕐 Snapshot:` timestamp and age in alert messages
  - Show `Δ ready: N → M` on state transitions
  - Clear state when floor is met (ensures next breach is immediate)

## Debounce logic
```
const stateChanged = previousReadyCount !== readyCount
const suppressed = !stateChanged && (now - lastAlert < cooldownMs)
if (readyCount < minReady && !suppressed) → alert
```

## Checks
- tsc --noEmit clean
