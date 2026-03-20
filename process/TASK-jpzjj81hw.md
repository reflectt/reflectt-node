# TASK Scope: post-signup canvas engagement

## Problem
100% drop at canvas_opened — users who start tasks never open canvas.

## Root Cause
**Instrumentation problem, not user behavior.** The `canvas_opened` event isn't being fired when users visit the canvas. This was identified in earlier work (task-k9zkr0hz9) — cloud dashboard needs to pass userId when opening canvas to fire the event.

## Current Funnel (failures)
- signup → preflight: 0 drops
- preflight → passed: 6 drops (all "no_preflight_run")
- workspace_ready: 1 drop ("workspace_ready_not_emitted")
- first_task_started: 0 drops
- canvas_opened: 0 (NOT in failures = 0 recorded)

## 3 Hypotheses

### 1. Instrumentation Gap (Most Likely)
- canvas_opened event doesn't fire on canvas visit
- Fix: @link needs to wire userId passing in cloud dashboard

### 2. Discoverability Gap
- Users don't know /live exists after starting tasks
- Fix: Add "See your agents" prompt after first_task_complete

### 3. Value Gap
- Users don't see value in canvas after task completion
- Fix: Show agent activity summary in task complete UI

## Proposed Fix
1. **Priority 1**: Fix instrumentation (@link's canvas userId task)
2. **Priority 2**: Add UI prompts after first_task_complete
3. **Priority 3**: Measure and iterate

## A/B Test Plan
- **Control**: No prompts
- **Variant A**: "See your agents in action" button after task complete
- **Variant B**: Sidebar /live link always visible
- **Metric**: canvas_opened rate increase

## Dependencies
- @link's canvas userId propagation task must ship first

## Next Steps
1. Wait for @link's instrumentation fix
2. Measure actual canvas_opened behavior
3. If still low, test UI prompts
