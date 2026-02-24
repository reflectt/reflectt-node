# Watchdog Behavior Explainer

This guide explains how the three watchdog paths behave, where cooldowns apply, and how to debug false-positive alerts.

## Components

### 1) Idle Nudge

Purpose: nudge when an agent appears idle beyond expected cadence.

Signal inputs typically include:
- recent task/message activity
- current task status (`doing`, `validating`, etc.)
- cooldown state from prior nudges

### 2) Cadence Watchdog

Purpose: detect sustained silence or missed update cadence.

Signal inputs typically include:
- elapsed time since last status update
- working-state indicators
- suppressions for known blocked/awaiting-review states

### 3) Mention Rescue

Purpose: rescue missed @mentions by issuing a fallback check.

Signal inputs typically include:
- mention timestamps
- acknowledgement lag (delay)
- rescue cooldown to prevent spam loops

Config:
- `MENTION_RESCUE_ENABLED` (default: enabled)
- `MENTION_RESCUE_DELAY_MIN` (default: **3**; values `<3` are clamped to **3**)

Clarifier:
- When `MENTION_RESCUE_DELAY_MIN` is unset, the **policy default** applies.
- If you set `MENTION_RESCUE_DELAY_MIN`, the value is still **clamped at runtime** to `>= 3`.
- `MENTION_RESCUE_COOLDOWN_MIN` (default: 10)
- `MENTION_RESCUE_GLOBAL_COOLDOWN_MIN` (default: 5)

Behavior notes:
- Rescue only @nudges the agents **actually mentioned** in the triggering message.
- The rescue message is a fallback: it should only fire after the delay window with no reply.

---

## Cooldown examples

1. **Recent update suppression**
   - If an agent posted within cooldown window, skip new nudge.

2. **Validating-state suppression**
   - If task is in `validating` with active PR/review flow, suppress idle nudge.

3. **Duplicate-cycle suppression**
   - If same condition fired in prior cycle and no material state change, hold repeat nudge.

4. **Mention rescue cooldown**
   - After one rescue prompt, hold additional rescue attempts until cooldown expires.

---

## Known failure modes

1. **Blocked-task false positives**
   - Watchdog nudges even when task is blocked and explicitly waiting.

2. **Contract drift side effects**
   - Status transitions fail silently; watchdog reads stale state and over-nudges.

3. **Queue-empty confusion**
   - Agent has no claimable task but is still flagged idle as if work exists.

4. **Thread noise amplification**
   - Repeated nudges bury real coordination messages.

5. **Missed mention + delayed rescue**
   - Rescue path runs too late due to stale timing state.

---

## Actionable debug workflow

### 1) Inspect current debug state

```bash
curl -s http://127.0.0.1:4445/health/idle-nudge/debug
```

### 2) Run dry-run watchdog ticks

```bash
curl -s -X POST 'http://127.0.0.1:4445/health/idle-nudge/tick?dryRun=true'
curl -s -X POST 'http://127.0.0.1:4445/health/cadence-watchdog/tick?dryRun=true'
curl -s -X POST 'http://127.0.0.1:4445/health/mention-rescue/tick?dryRun=true'
```

### 3) Compare against live task state

```bash
curl -s 'http://127.0.0.1:4445/tasks?assignee=echo&status=doing'
curl -s 'http://127.0.0.1:4445/tasks?assignee=echo&status=validating'
```

### 4) Verify suppression reason before escalation

Escalate only if:
- cooldown/suppression flags are absent, and
- agent state is truly stale against task + message timeline.

---

## Activity Signal (effective_activity_ts)

**Added:** task-1771907836654-txobnxkmc

All enforcement paths now use a canonical activity signal instead of raw `task.updatedAt`:

```
effective_activity_ts = max(
  last_status_comment_at,    -- most recent task comment by assigned agent
  last_state_transition_at,  -- most recent status change in task_history
  task_created_at,           -- fallback for brand-new tasks
)
```

### Why not updatedAt?

`task.updatedAt` is bumped by any edit — metadata changes, reviewer assignment, tag updates.
This causes false "not stale" readings (hiding real inactivity) and false "stale" readings
(when a non-activity edit is old).

### Source tracking

Every enforcement warning now includes the signal source and threshold:

```
⚠️ [Product Enforcement] @link, task task-123 ("Fix auth") —
last activity: 95m ago (status comment at 2025-07-05 14:23 UTC), threshold: 90m.
Post a status comment within 30m or the task will auto-requeue to todo.
```

### Monotonic guard

The signal uses `max()` across all sources. Older signals cannot overwrite newer ones.
This prevents a scenario where a state transition from hours ago regresses a recent comment timestamp.

### Affected paths

| Path | File | Before | After |
|------|------|--------|-------|
| Board health (stale doing) | `boardHealthWorker.ts` | `max(updatedAt, latestComment)` | `getEffectiveActivity()` |
| Working contract (auto-requeue) | `working-contract.ts` | `getLastActivityForAgent()` or `updatedAt` | `getEffectiveActivity(taskId, agent)` |
| Idle nudge (stale lane) | `idleNudgeLane.ts` | raw `updatedAt` | `effectiveActivityTs` field (when populated) |

### Debug

```bash
# Check a task's activity signal
curl -s http://localhost:4445/tasks/<taskId> | jq '.task.metadata'
# Or from the DB:
# SELECT MAX(timestamp) FROM task_comments WHERE task_id = ? AND author = ?
# SELECT MAX(timestamp) FROM task_history WHERE task_id = ?
```

---

## Verification checklist

- [ ] All three watchdog paths are documented
- [ ] Cooldown logic includes concrete examples
- [ ] Failure modes include false-positive scenarios
- [ ] Debug steps are copy/paste runnable
