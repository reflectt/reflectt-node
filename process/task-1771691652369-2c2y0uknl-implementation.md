# Shipped-Artifact Auto-Heartbeat — Implementation Notes

**Task:** task-1771691652369-2c2y0uknl  
**Design:** scout (pilot spec)  
**Implementation:** link  
**Reviewer:** sage  

## Done Criteria Mapping

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Compact heartbeat payload format documented | `shipped-heartbeat.ts` → `formatMessage()` + `ShippedHeartbeatPayload` type. Format: `[SHIP] <task_id> \| shipped:<ref> \| next:<eta> \| review:@<reviewer> \| by:@<owner>` |
| 2 | Trigger + suppression rule documented | `shipped-heartbeat.ts` header doc + `handleTaskEvent()`. Triggers on `task_updated` → status ∈ {validating, done} with artifact_path. Suppression: dedup(30m), reviewer override(5m), invalid artifact path |
| 3 | At least 3 example messages (ops/product/comms) | `shipped-heartbeat.test.ts` → "example messages by lane" describe block with ops, product, comms examples |
| 4 | Failure mode notes included | `shipped-heartbeat.ts` header JSDoc + test suite "failure mode:" describe blocks |

## Architecture

```
task_updated event (eventBus)
  → handleTaskEvent()
    → status check (validating/done only)
    → artifact_path validation (process/, src/, docs/)
    → dedup check (30m window per task)
    → reviewer override check (5m look-back in #general)
    → buildPayload() → formatMessage()
    → chatManager.sendMessage() → #general
```

## Compact Payload Contract (sage-validated)

```
[SHIP] <task_id> | shipped:<artifact_path> | next:<eta|done|pending review> | review:@<reviewer> | by:@<owner>
```

## Suppression Rules

1. **Dedup (30m):** Same task won't fire twice within 30 minutes. Prevents spam on rapid status flips (validating→blocked→validating).
2. **Reviewer override (5m):** If the task's reviewer posts in #general mentioning the task ID within 5 minutes of the trigger, auto-heartbeat is suppressed.
3. **Missing/invalid artifact:** Tasks without `metadata.artifact_path` or with non-canonical paths are silently skipped (logged at warn level).
4. **Chat budget:** Respects existing noise-budget in `chatManager.sendMessage()`. If budget blocks, message is not retried.

## Example Messages

### Ops
```
[SHIP] task-ops-deploy-001 | shipped:process/deploy-runbook.md | next:~1h | review:@kai | by:@link
```

### Product
```
[SHIP] task-prod-spec-002 | shipped:process/onboarding-spec.md | next:pending review | review:@pixel | by:@scout
```

### Comms
```
[SHIP] task-comms-docs-003 | shipped:docs/v2-launch-post.md | next:done | review:@sage | by:@echo
```

## Failure Modes

| Mode | Cause | Mitigation |
|------|-------|------------|
| Duplicate spam | Rapid status flips (validating→blocked→validating) | 30m dedup window per task ID |
| Missing artifact link | Task moved to validating without `metadata.artifact_path` | Skip + warn log; lifecycle gate in tasks.ts already enforces this for validating |
| Reviewer already posted | Reviewer writes their own update before auto-heartbeat fires | 5m look-back suppression in #general |
| Chat budget exceeded | Channel noise budget full | Graceful skip via existing noise-budget; no retry |
| Stale dedup map | Memory leak from accumulated entries | Periodic cleanup every 30m via `cleanupDedupMap()` |

## Files Changed

- `src/shipped-heartbeat.ts` — New module (event listener, payload builder, suppression logic)
- `src/server.ts` — Import + wire start/stop/stats endpoint
- `tests/shipped-heartbeat.test.ts` — 20+ test cases covering all done criteria
- `process/task-1771691652369-2c2y0uknl-implementation.md` — This file

## Telemetry

- `GET /shipped-heartbeat/stats` → `{ totalEmitted, totalSuppressed, suppressionReasons, lastEmittedAt }`
- Counter breakdowns by suppression reason for ops monitoring

## Known Caveats

- Reviewer override check depends on `chatManager.getMessages()` returning in-memory messages; if chat history is large, the look-back may not capture all messages (mitigated by limit=20 + since filter).
- Design artifacts from scout's branch (PR #266) are unreachable — spec was reconstructed from task metadata + comments.
