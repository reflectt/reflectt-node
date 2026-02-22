# QA: Fix Sweeper Orphan-PR Alert Accuracy

**Task:** task-1771528795686-vlo80yxan  
**PR:** #234 (link/fix-sweeper-orphan-accuracy)  

## Fix: Fail-Closed Orphan Alert Gate

### Before (false positives on unknown state)
```
checkLivePrState → state: unknown (gh auth failure)
→ falls through to orphan_pr emission
→ FALSE POSITIVE: alert fires for PR that may be merged/closed
```

### After (fail-closed: only alert on confirmed OPEN)
```
checkLivePrState → state: unknown
→ logDryRun('orphan_pr_degraded_check', 'suppressing alert')
→ continue (NO alert)

checkLivePrState → state: open
→ proceed to orphan_pr emission (CORRECT alert)

checkLivePrState → state: merged/closed
→ skip (already handled)
```

## Gate Logic (executionSweeper.ts)

1. `taskDone` → call `checkLivePrState(prUrl)`
2. `merged` or `closed` → skip, log `orphan_pr_skipped`
3. `unknown` → skip, log `orphan_pr_degraded_check` (fail-closed)
4. `open` → proceed to alert if `completedAge >= ORPHAN_PR_THRESHOLD_MS`

## Alert Payload Format

```json
{
  "taskId": "task-abc",
  "title": "Fix broken auth flow",
  "assignee": "link",
  "reviewer": "sage",
  "type": "orphan_pr",
  "age_minutes": 45,
  "message": "🔍 Orphan PR detected: https://github.com/reflectt/reflectt-node/pull/100 linked to done task \"Fix broken auth flow\" (task-abc). PR may still be open — @link close or merge it. @sage — confirm status."
}
```

## Test Evidence

- Existing regression test: merged PR linked to done task must not alert
- New behavior: unknown state also suppressed (degraded-check log only)
- 573 tests pass, tsc clean
