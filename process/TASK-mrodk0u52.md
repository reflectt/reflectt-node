# Task: feat: enforce routing payload schema (task-1773262304190-mrodk0u52)

## Summary
Enforced routing payload schema (`action_required` + `urgency`) at the API boundary for agent event endpoints. Callers can no longer opt out via `enforceRouting: false` in the request body. Added a new `POST /runs/:runId/events` endpoint.

## Changes

### `src/server.ts`
- `POST /agents/:agentId/events`: removed `enforceRouting` from accepted body type; handler now always passes `enforceRouting: true` to `appendAgentEvent`. Callers cannot bypass routing validation.
- `POST /runs/:runId/events` (NEW): accepts event posting by runId without requiring agentId. Resolves `agentId` via `getAgentRun(runId)`. Returns 404 if run not found. Returns 422 with hint on routing violation. Always enforces routing.

### `public/docs.md`
- Updated `POST /agents/:agentId/events` entry to note routing enforcement.
- Added `POST /runs/:runId/events` entry.
- Route/docs contract: 504/504.

### `tests/routing-enforcement-api.test.ts` (NEW)
- 10 API-boundary tests covering both endpoints, all 4 `action_required` values, all 3 `urgency` values, non-actionable passthrough, and bypass attempt.

## Done Criteria
- [x] `POST /runs/:id/events` rejects events missing `action_required` or `urgency` when payload indicates routing
- [x] `action_required` must be one of: `review|unblock|approve|fyi`
- [x] `urgency` must be one of: `blocking|normal|low`
- [x] Enforced at API layer, not just in docs

## Test Results
- 1906/1906 tests pass
- Route/docs contract: 504/504

## PR
https://github.com/reflectt/reflectt-node/pull/935
