# Task: Unified Policy Config
**ID**: task-1771287936547-iie9xsan3
**Branch**: link/task-iie9xsan3
**Assignee**: link
**Reviewer**: kai

## Summary
Single canonical policy file in `~/.reflectt/policy.json` consumed by watchdog, board health, and quiet hours systems. Replaces 20+ scattered env vars with one editable config, while preserving env var overrides for backwards compat.

## Changes
- **New**: `src/policy.ts` — PolicyManager class
  - Deep-merge config from file → env overrides → runtime PATCH
  - Sections: quietHours, idleNudge, cadenceWatchdog, staleDoingThreshold, mentionRescue, boardHealth, escalation
  - Persists to `~/.reflectt/policy.json` on every update
  - Reset to defaults endpoint
- **Modified**: `src/server.ts`
  - Quiet hours now reads from policyManager (removed 4 hardcoded constants)
  - Board health worker initialized from policy config
  - 3 REST endpoints: GET/PATCH /policy, POST /policy/reset
- **Modified**: `tests/modules.test.ts` — 5 new tests (190 total)
- **Modified**: `public/docs.md` — 3 new route entries (176/176)

## Done Criteria Mapping
- ✅ Single canonical policy file in ~/.reflectt
- ✅ Consumed by watchdog, board health, and SLA systems (quiet hours refactored)
- ✅ Configurable thresholds: inactive-hours, stale windows, digest cadence, escalation channels
- ✅ Replaces hardcoded values in code (quiet hours constants removed, board health reads from policy)

## Test Proof
- 190 tests pass, 1 skipped (pre-existing)
- Route-docs 176/176
- tsc --noEmit clean
