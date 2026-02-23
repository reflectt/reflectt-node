# P0-1: Control-plane noise budget — canary + full rollout

## Task
task-1771849166394-z0f4u8lc7

## PR
reflectt-node #266 (merged, commit 6123a55)

## Implementation
1. **Per-channel message budget**: Rolling 1hr window (general=30, shipping=20, reviews=20, blockers=15, default=40)
2. **Duplicate suppression**: 5-min window, normalized content hash (strips timestamps/task IDs)
3. **System reminder digest batching**: 30s window, batches multiple system reminders into numbered digest
4. **Build-freshness check**: Startup warning if src/ is newer than dist/ (prevents stale-dist regression)

## Denominator Definition
**Noise ratio** = control-plane messages / total #general messages (rolling 24h)
- **Numerator**: Messages matching system reminder patterns (working contract warnings, SLA breach alerts, reflection nudges, auto-requeue notices, product enforcement)
- **Denominator**: All messages in #general, EXCLUDING: bot acks/reactions, system joins/leaves, empty/synthetic messages (budget_exceeded, suppressed, queued IDs)
- Target: <=30% sustained over 7 days

## Critical Reminder Audit Method
- Suppressed messages logged via `console.warn('[Chat/NoiseBudget] ...')` with from/channel context
- Digest-batched messages preserve full content in numbered list (no content lost, only consolidated)
- Budget-exceeded messages get `metadata.budget_exceeded=true` for downstream audit
- Bypass available via `metadata.bypass_budget=true` for truly critical alerts

## Canary Status
- **Canary deployed**: PR #266 merged to main, running on production server
- **T0**: 2026-02-23T12:37:41Z (canary config applied)
- **Config**: `general=0.3`, `canaryMode=true`
- **Canary endpoint**: `/canary` returns 200, rollback=false
- **24h stable canary**: PENDING (need T0+24h observation = 2026-02-24T12:37Z)
- **7-day <=30% sustained**: PENDING (need T0+7d = 2026-03-02)

## Caveats
- Budget limits may need tuning after observation period
- 24h + 7-day criteria require elapsed time — cannot be evidenced yet
- Rollback plan: revert PR #266 (single squash commit)
