# task-1771971304787-3gs8t57n0 — Reflection gate reclaim unblock (stale tracking reconciliation)

**Insight:** ins-1771971304740-jd60sjjy1  
**Owner:** link  
**Reviewer:** sage  
**Date:** 2026-02-24

## Problem

Agents can be blocked by the **working-contract reflection gate** (422 `reflection_overdue`) while they have submitted recent reflections.

Observed evidence (from insight):
- `PATCH /tasks/:id` → 422 `reflection_overdue` even though reflections exist (e.g., `ref-1771952448811-wu85xbqb0`, `ref-1771952172649-ue4vvnfmt`).
- Gate reason references `tasks_done_since_reflection`, suggesting the `reflection_tracking` row is stale and not being reset.

## Root cause

`checkClaimGate()` relied exclusively on the `reflection_tracking` table:
- `last_reflection_at`
- `tasks_done_since_reflection`

If a reflection is ingested through any path that writes into `reflections` **without** calling `onReflectionSubmitted()` (e.g., sync/integration paths), the `reflection_tracking` row can remain stale:
- `tasks_done_since_reflection` stays high
- `last_reflection_at` stays old

Result: the agent can be *permanently* blocked from re-claiming work even after reflecting.

## Fix

When the gate would block (`tasksDone >= 2 && hoursSinceReflection > 4`), `checkClaimGate()` now performs a **reconciliation** step:

1. Read latest reflection for `author=agent` via `listReflections({ author, limit: 1 })`.
2. If that reflection is newer than `reflection_tracking.last_reflection_at`, treat it as a missed tracking reset:
   - Upsert `reflection_tracking` with `last_reflection_at = latest.created_at`
   - Reset `tasks_done_since_reflection = 0`
   - Allow the claim.

This restores **signal over noise**: the hard gate enforces the real reflection stream, not a stale counter.

## Tests / proof

- Added regression test: `checkClaimGate reconciles stale tracking when a newer reflection exists`
  - Inserts a stale `reflection_tracking` row
  - Creates a reflection directly via `createReflection()` (simulating non-HTTP ingestion)
  - Verifies gate allows and tracking row is repaired (tasks_done_since_reflection=0)

Full suite:
- `npm test --silent` → **991 passed**, 1 skipped

## Files changed

- `src/working-contract.ts`
- `tests/working-contract.test.ts`

## Notes / follow-ups

- This is intentionally **defensive**: it keeps enforcement intact while preventing lockouts caused by stale tracking.
- Optional follow-up: add logging/telemetry when reconciliation occurs (rate-limited) to identify ingestion paths missing `onReflectionSubmitted()`.
