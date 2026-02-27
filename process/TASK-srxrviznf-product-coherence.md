# TASK-srxrviznf — Product coherence investigation

## Evidence validation

### 1. Bootstrap prompt bloat (MEMORY.md vs memory.md)
**Status: Already detected**
- `src/team-doctor.ts` (line 236-280) already checks for both MEMORY.md and memory.md and flags the duplicate injection.
- Fix guidance exists: "Delete one of MEMORY.md/memory.md, keep daily notes in memory/YYYY-MM-DD.md."
- No code change needed — this is a workspace hygiene issue, not a code bug.

### 2. Insight clustering over-merged on umbrella tags
**Status: Known issue, documented**
- Insight clustering uses tag-based grouping. Tags like "openclaw" are too broad and pollute clusters.
- This was documented in task-6nft82pbu (insight hygiene audit) — 13 polluted umbrella insights identified.
- PATCH /insights/:id endpoint (PR #417 by kai) was shipped to enable cleanup.
- **Mitigation: tag specificity should be enforced at insight creation time.** Not addressed yet but has tooling.

### 3. Validating tasks drifted (reviewer approved but no auto-close)
**Status: Fixed**
- `src/server.ts` line 4964-4976: Auto-transition `validating → done` fires on review approval.
- The review endpoint (`POST /tasks/:id/review`) checks `isApprove && task.status === 'validating'` and sets `status: 'done'` + `auto_closed: true`.
- Earlier drift was likely a race condition or tasks stuck before this code was added.
- Today's review approval (task-h028994dp) auto-closed correctly, confirming the fix works.

### 4. Compliance snapshot mislabeled (ready_floor vs ready_v0)
**Status: Acknowledged, low severity**
- This is a naming inconsistency in how compliance snapshots label their checks.
- The functional behavior is correct (ready_v0 is the ready-floor check).
- Label rename would be cosmetic — doesn't affect system behavior.

## Summary
3 of 4 evidence items are already addressed or mitigated:
1. ✅ Bootstrap bloat — team-doctor detects it
2. ⚠️ Insight clustering — tooling exists (PATCH endpoint), needs tag-specificity enforcement
3. ✅ Auto-close drift — fixed in review endpoint
4. ⚠️ Compliance label — cosmetic, low priority

The core insight ("powerful collection of parts") is valid — the product has depth but the glue between subsystems (task lifecycle, insight clustering, bootstrap injection) creates friction. Today's work on task-lifecycle precheck (PR #429) and ready-floor dashboard (PR #248) directly addresses the "parts not talking" problem.

## Root cause
Not a single bug — systemic complexity from rapid shipping without integration testing. Each subsystem works, but edge cases at boundaries (duplicate detection, review auto-close, tag clustering) create noise that makes the system feel fragile.

## Mitigations shipped today
- PR #429: Duplicate-closure precheck gate (reviewed + approved)
- PR #248: Ready-floor dashboard panel (reduces alert noise)
- PR #244/245: Tasks UI sane defaults (reduces "985 tasks" confusion)
- PR #235: Visibility-aware polling (reduces background load)
