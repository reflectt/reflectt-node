# QA Bundle: task-1771872636780-ko0lk4tdq

## Summary
BYOH preflight drop-off instrumentation + comprehensive e2e tests.
Adds `host_preflight_passed`/`host_preflight_failed` activation funnel events
and 23 tests covering all preflight checks end-to-end.

## Changes
- `src/activationEvents.ts`: 2 new event types in activation funnel
- `src/preflight.ts`: Drop-off event emission with userId tracking
- `src/server.ts`: userId passthrough on POST /preflight
- `tests/preflight.test.ts`: 23 tests (individual checks, integration, format, drop-off)
- `tests/activationEvents.test.ts`: Updated for new event types
- `public/docs.md`: Updated endpoint docs

## Test Results
- 889 tests pass (53 files)
- Preflight: 23 tests (8 individual + 9 integration + 2 format + 4 drop-off)
