# Task z16dkyu8o — Reflection-Origin Gate on Task Creation

## Summary

Enforces that all tasks created via `POST /tasks` must trace back to a reflection or insight, unless explicitly exempted with a reason.

## What Was Already Done

The core validation was already implemented in `checkDefinitionOfReady()` (server.ts lines ~247-263):
- Checks for `metadata.source_reflection`, `metadata.source_insight`, or `metadata.source === 'reflection_pipeline'`
- If `metadata.reflection_exempt === true`, requires `metadata.reflection_exempt_reason`
- Enforced on both `POST /tasks` and `POST /tasks/batch-create`

Tests existed and pass: `tests/reflection-origin-gate.test.ts` (6 tests covering reject/accept/exempt paths).

## What Was Added

Fixed 3 internal callers that bypass the HTTP-level check to include proper reflection metadata:

1. **Feedback triage** (line ~6862): Added `reflection_exempt: true` + reason "System-created from user feedback triage"
2. **Insight triage** (line ~7556): Added `source_insight` and `source_reflection` from the insight being triaged (these were missing despite the task originating from an insight)
3. **Research handoff** (line ~8535): Added `reflection_exempt: true` + reason "System-created from research handoff pipeline"

The orphan insight reconciliation path (line ~7338) already had proper `source_insight`/`source_reflection` metadata.

## Verification

- `tsc --noEmit`: Clean
- `vitest run tests/reflection-origin-gate.test.ts`: 6/6 pass
- All done criteria met:
  - ✅ Task creation rejects without reflection source
  - ✅ Exempt tasks require reason
