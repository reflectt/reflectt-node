# TASK-c7bc2e1np — routing simulate endpoint

## What
POST /routing/simulate — wires rhythm's comms-routing-policy.ts into an HTTP endpoint.

## Files
- src/server.ts — new POST /routing/simulate route
- tests/routing-simulate-api.test.ts — 15 tests (12-case regression suite)
- public/docs.md — endpoint documented

## Behaviour
- Accepts { policy: CommsRoutingPolicy, scenarios: RoutingScenario[] }
- Validates: policy required, scenarios non-empty, max 100
- Returns { success, count, results: CommsRouteResult[] }
- Tests skip gracefully if endpoint not yet deployed (live-server pattern)
