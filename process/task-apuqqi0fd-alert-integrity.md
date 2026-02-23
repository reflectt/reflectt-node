# Task: P0-2 Alert-Integrity Guard — Preflight Reconciliation

**Task ID:** task-1771849175579-apuqqi0fd
**PR:** https://github.com/reflectt/reflectt-node/pull/273
**Branch:** link/task-apuqqi0fd
**Commit:** f997f20

## Problem
17.5% of control-plane chatter references stale/false alerts — SLA warnings for done tasks, idle nudges for recently active agents, duplicate requeue alerts.

## Solution
AlertIntegrityGuard class with 6 preflight checks, integrated into messageRouter before noise budget.

### Checks
1. Task exists → suppress alerts for deleted/missing tasks
2. Task done → suppress stale alerts (escalations bypass)
3. Status reconciliation → suppress if status changed since alert generated
4. Assignee/reviewer reconciliation → suppress if ownership changed
5. Recent activity → suppress if task was commented on within 5min
6. Idempotent dedup → task_id + alert_type + state_hash key, 15min window

### Integration
- Runs in `routeMessage()` before noise budget check
- Only applies to task-scoped messages (has taskId + category)
- Escalations always bypass preflight
- Canary mode: logs but allows all messages (default on)
- `POST /chat/alert-integrity/activate` exits canary mode

### Audit & Observability
- Full audit log with task, type, result, latency
- Stats: total checked/allowed/suppressed, by reason
- Latency tracking: avg + p95
- Rollback signals: missed true positives, p95 latency, critical alert errors

## Files
- `src/alert-integrity.ts` — 409 lines (guard class + singleton)
- `src/messageRouter.ts` — +35 lines (preflight integration)
- `src/server.ts` — +43 lines (6 API endpoints)
- `tests/alert-integrity.test.ts` — 17 tests

## Test Proof
791 passed, 1 skipped, 1 pre-existing flaky (insight-listener race in parallel suite)

## Rollout
1. ✅ Implementation merged
2. ✅ Canary mode active (default)
3. ⏳ 24h stable canary observation
4. ⏳ Activate enforcement
5. ⏳ Monitor for <2% false-positive rate over 7 days
