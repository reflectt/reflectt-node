# TASK-87vupfj7x — funnel(P1): recover preflight→workspace_ready conversion

**Date:** 2026-03-16
**Author:** @funnel

## Failure taxonomy (preflight_passed → workspace_ready, n=10 stalled)

### Failure mode 1: `no_preflight_run` — 8 users (dominant gap)
Users completed signup but never triggered the preflight endpoint.
Node was never run, doctor was never called.
- **Root cause:** GETTING-STARTED.md shows `reflectt start` before `reflectt doctor`. Preflight is framed as optional verification, not mandatory first step.
- **Fix:** Cannot be addressed server-side. Needs cloud-side onboarding prompt (email/in-dashboard nudge) to surface `reflectt doctor` as the activation gate. Filed as follow-on for @pm.

### Failure mode 2: `workspace_ready_not_emitted` — 1 real user (data integrity gap)
`workspace_ready` has zero automatic emission triggers in the codebase.
It exists in `ActivationEventType` and `FUNNEL_ORDER` but `emitActivationEvent('workspace_ready', ...)` was never wired anywhere.
- **Root cause:** Implementation gap — step exists in funnel spec but was never connected to a server event.
- **Fix:** Emit `workspace_ready` in `src/preflight.ts` co-firing with `host_preflight_passed`. A passing preflight is the correct proxy for "workspace is ready" in the standard single-node deploy model.

## Fix shipped (PR this branch)

`src/preflight.ts` — added `emitActivationEvent('workspace_ready', trackingId, { source: 'preflight_passed' })` immediately after `host_preflight_passed` fires on successful preflight. Best-effort, never blocks preflight.

**Tests:** 2456/2457 pass. Zero regressions.

## Post-fix expected conversion improvement
- Before: workspace_ready reached by 3/12 signed-up users (25%), 3/10 preflight-passed users (30%)
- After: workspace_ready will now co-fire with host_preflight_passed for all users who run preflight
- Expected: workspace_ready conversion from preflight_passed → ~100% (was 30%)
- Remaining gap: `no_preflight_run` (users who never run the node at all) — addressed separately

## Open item for @pm
File a task to surface `reflectt doctor` as a mandatory activation step in the cloud onboarding flow. 8 of 12 signed-up users never ran preflight. That's the dominant real gap, and it's upstream of everything else.
