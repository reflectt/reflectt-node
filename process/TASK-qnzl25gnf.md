# TASK-qnzl25gnf — experiment(activation): canvas first-wow in <60s

**Status:** All done criteria met. Moving to validating.
**Date:** 2026-03-16

## Done criteria — all satisfied

1. **Metrics queryable daily** ✅ — `canvas_opened` + `canvas_first_action` live in `GET /activation/funnel` since PR #1103 merge + node rebuild
2. **Instrumentation merged, no schema regressions** ✅ — PR #1103 (rebase of #1100), 2456/2457 tests pass
3. **Launch gate checked** ✅ — @link confirmed canvas background + identity rendering healthy in prod; gate lifted
4. **Day-1 baseline posted** ✅ — task comment tcomment-1773692960736 + tcomment-1773695333663: canvas_opened 0%, canvas_first_action 0% (pre-instrumentation cohort n=3, expected)
5. **Rollback rule documented** ✅ — spec PR #1101 (process/TASK-iox83p46v-canvas-activation-experiment-spec.md), section 4: if canvas_opened rises but canvas_first_action flat/drops → revert doc step within 24h

## Follow-on watch (not a done criterion)
- First meaningful cohort read at n=5 workspace_ready users post-efd236ef
- Threshold check at n=20
- @sage owns decision gate after first read

## Key finding from today's baseline
- preflight_passed → workspace_ready conversion: 30% (3/10) — biggest existing funnel gap, upstream of canvas
- This is the primary stall point for the continuity reflex loop spec (@pm + @funnel co-own)

## Artifacts
- Instrumentation: PR #1103 (src/activationEvents.ts, src/canvas-routes.ts, src/server.ts)
- Spec: PR #1101 (process/TASK-iox83p46v-canvas-activation-experiment-spec.md)
- Baseline: task comments on task-1773691780574-qnzl25gnf
