# TASK task-1771218962384-uyjm2g4xc — CI single-command E2E dogfood gate

## Summary
Implemented the dogfood smoke gate so one command now verifies:
1) enroll/register token + claim host
2) heartbeat
3) task sync
4) cloud host+task reflection
5) dashboard path reachability

## Code changes
- `src/cli.ts`
  - Added **task sync** step to `dogfood smoke` flow.
  - Tightened cloud verification to require both host visibility and synced task visibility.
  - Tightened dashboard verification to require host + synced task reflection.
- `tests/dogfood-smoke-cli.test.ts`
  - Added integration-style CLI test that runs the full flow in one command against local test servers.

## Proof
### Focused command
```bash
npm test -- --run tests/dogfood-smoke-cli.test.ts
```
Result: `1 test passed`.

### Broader sweep command
```bash
npm test -- --run tests/api.test.ts tests/embeddings.test.ts tests/dogfood-smoke-cli.test.ts
```
Result:
- `Test Files: 3 passed`
- `Tests: 81 passed, 1 skipped`
- Duration ~35s

## Status
- Ship candidate: ✅
- No known blocker at handoff time.
