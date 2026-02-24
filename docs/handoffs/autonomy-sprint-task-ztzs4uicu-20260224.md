# Autonomy-reliability sprint snapshot (task-1771742065414-ztzs4uicu)

Date: 2026-02-24

This is the consolidated pass/fail snapshot required by the P0 sprint task.

## Counts (last 24h)
- Reflections: **79** (24h) / **178** (total)
- Insights created: **22** (24h) / **78** (total)
- Insights → tasks: **14** (24h) / **43** (total)
- Recurring task defs: **118** (enabled=1, disabled=117)
- Recurring insight candidates: **1**

## Queue floor / backlog health
- overall: `healthy` (ready=258, notReady=1, doing=4, blocked=9, staleValidating=0)
- operations lane: `healthy` (readyFloor=1, ready=6, doing=2, floorBreaches=0)

## Continuity loop
- cyclesRun=33; lastRunAt=1771916879491
- insightsPromoted=0; reflectionNudgesFired=0; noCandidateCycles=0

## Proof artifacts (via /tasks/:id/artifacts)
Active autonomy-reliability tasks checked:

- **task-1771849166394-z0f4u8lc7** (blocked/time-gated)
  - artifacts accessible: 6/7
  - note: `metadata.artifacts[]` contains a non-path string (`"reflectt-node PR #266 (merged)"`) which fails file resolution; URL evidence still passes.

- **task-1771849175579-apuqqi0fd** (blocked/time-gated)
  - artifacts accessible: 5/5

- **task-1771910196867-sxoi7m2td** (doing)
  - checkpoint artifact attached: `process/task-sxoi7m2td-autoclose-guard-checkpoint-20260224.md`

- **task-1771916318168-90n5u05uv** (validating)
  - PR #289 green (checks success) pending reviewer approval

Canonical raw snapshot artifact (repo-local):
- `process/task-ztzs4uicu-autonomy-sprint-snapshot-20260224.md`

## Pass/Fail
- Artifact visibility endpoint: **PASS**
- Noise budget (z0f4u8lc7): **HOLD** (time-gated canary + 7d noise ratio)
- Alert-integrity guard (apuqqi0fd): **HOLD** (time-gated canary + 7d FP rate)
- Auto-close guard (sxoi7m2td): **IN PROGRESS**
- Reflection nudge hardening (90n5u05uv / PR #289): **GREEN pending review**
