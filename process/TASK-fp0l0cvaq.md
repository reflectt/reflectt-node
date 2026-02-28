# Task: Ready-queue floor false breach when agent is active
**Task ID:** task-1772217837983-fp0l0cvaq
**PR:** https://github.com/reflectt/reflectt-node/pull/521
**Commit:** 74cf9a9

## Problem
The system digest posted **Ready-queue floor** warnings even when an agent was not idle — specifically when they had active `doing` work or were `validating` (validating-only queue).

This created noise and misled readers into thinking the agent was idle/unfed.

## Fix
### 1) Breach semantics in `BoardHealthWorker.checkReadyQueueFloor`
- Compute `doing` + `validating` counts per monitored agent.
- Define breach as: `below floor` **AND** `doing + validating == 0`.
- If below-floor but agent is active, emit an **info** message (not a breach) that includes `doing`/`validating` counts.

### 2) Idle escalation counts validating as active
- Idle escalation now treats `validating` as work (avoids validating-only false idle escalation).

### 3) Digest messaging clarity
Messages now include `doing` and `validating` counts so it’s obvious whether it’s:
- **no queued todo tasks but agent active**, or
- **true idle** (no doing/validating).

## Proof / Regression
Added test coverage:
- `tests/ready-queue-floor-breach-semantics.test.ts`
  - validating-only queue → **no** `ready-queue-warning` action
  - validating-only queue → **no** `idle-queue-escalation`
  - no doing/validating + below floor → `ready-queue-warning` emitted

## Testing
- `npx vitest run tests/ready-queue-floor-breach-semantics.test.ts`
- `npx vitest run tests/ready-queue-floor.test.ts`
