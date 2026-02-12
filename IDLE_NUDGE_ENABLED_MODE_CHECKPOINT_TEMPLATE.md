# Idle-Nudge Controlled Enabled-Mode Checkpoint

Task: `task-1770916206001-tppfibok0`

## Run Metadata
- Timestamp:
- Commit hash:
- Runtime env proof (`IDLE_NUDGE_ENABLED=true`):
- Base URL:

## Endpoint Smoke (exact command + output)

### 1) GET `/health/idle-nudge/debug`
- Command:
- Status:
- Key fields: `enabled`, `warnMin`, `escalateMin`, `cooldownMin`, `recentSuppressMin`

### 2) POST `/health/idle-nudge/tick?dryRun=true`
- Command:
- Status:
- Key fields: `success`, `dryRun`, `nudged[]`, `decisions[]`

### 3) POST `/health/idle-nudge/tick`
- Command:
- Status:
- Key fields: `success`, `dryRun`, `nudged[]`, `decisions[]`

## PASS/FAIL Rubric (G1-G6)
- G1 Config gate (`IDLE_NUDGE_ENABLED=true`): PASS/FAIL
- G2 Sub-threshold negatives (`0m/2m/just-posted` no nudge): PASS/FAIL
- G3 Placeholder suppression (`<task-id>` absent): PASS/FAIL
- G4 Tier behavior (warn/escalate evidence): PASS/FAIL
- G5 Cooldown suppression (no duplicate within cooldown): PASS/FAIL
- G6 Rollback safety (`IDLE_NUDGE_ENABLED=false` restored with proof): PASS/FAIL

## Verdict
- Overall: PASS/FAIL
- Blockers (if any):
- Next action:
