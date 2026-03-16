# TASK-f3ggtwnbr — feat(activation): canvas_opened + canvas_first_action events

**PR:** https://github.com/reflectt/reflectt-node/pull/1100
**Commit:** efba62e
**Branch:** funnel/task-f3ggtwnbr

## What was done

Added two new activation events to track canvas discovery and conversion:

### `canvas_opened`
- Fires on `GET /canvas/states` — the discovery endpoint used by the first-wow doc step
- Optional `?userId=` query param; falls back to `anonymous` for aggregate rate tracking
- Idempotent per userId

### `canvas_first_action`
- Fires on `POST /canvas/push` and `POST /canvas/takeover`
- Uses `agentId` from request body (full attribution, no fallback needed)
- Idempotent per agentId

## Files changed
- `src/activationEvents.ts` — added both types to ActivationEventType union; initialized in getUserFunnelState, getFunnelSummary (×2), weekly trends stepCounts
- `src/canvas-routes.ts` — imported emitActivationEvent; wired canvas_opened on GET /canvas/states
- `src/server.ts` — wired canvas_first_action on POST /canvas/push and POST /canvas/takeover

## Test results
2456/2457 pass. Zero new failures. Pre-existing failures (stagehand, sentry optional deps) unchanged.

## Caveats
- `canvas_opened` attribution is `anonymous` for dashboard tab opens until dashboard passes `?userId=`
- Aggregate open rate is valid from day one; per-user breakdown needs small dashboard follow-up
- `canvas_first_action` has full agentId attribution from write request body

## Metrics target
- Baseline: 0% (canvas undocumented before efd236ef)
- Target: 40%+ canvas_opened rate, 20%+ canvas_first_action rate per workspace_ready cohort
