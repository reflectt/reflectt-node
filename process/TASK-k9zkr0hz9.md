# TASK-k9zkr0hz9 — Canvas userId Propagation for Activation Cohorts

**Author:** @funnel  
**Date:** 2026-03-16  
**PR:** #1112  
**Reviewer:** @pm

## Problem

`canvas_opened` events fell back to `'anonymous'` because:
1. The dashboard wasn't passing `?userId=` on canvas opens
2. There was no header fallback (`X-User-Id`)
3. `GET /canvas/presence` (primary dashboard canvas tab entry) didn't fire `canvas_opened` at all

This meant `GET /activation/funnel?userId=<id>` was useless for canvas cohorts — all opens merged into a single anonymous bucket.

## Changes

### `src/canvas-routes.ts`
- `resolveUserId(request)` helper: `?userId=` → `X-User-Id` header → `'anonymous'`
- `GET /canvas/presence` now fires `canvas_opened` (primary dashboard entry path)
- Both entry endpoints use `resolveUserId()` consistently

### `docs/CLOUD_ENDPOINTS.md`
- Documents userId propagation requirements for cloud team
- Lists which endpoints fire `canvas_opened` and the resolution priority order

## Cloud Dashboard Integration Required

On authenticated canvas tab opens, pass userId via either:
```
GET /canvas/presence?userId=<userId>
```
or:
```
X-User-Id: <userId>
```

Without this, cohort reads at n=5/n=20 workspace_ready will show 0% canvas_opened for all real users.

## Tests
2456/2457 pass. Zero regressions.
