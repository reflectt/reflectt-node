# TASK-qx123gfr4 — infra(node): lane validation at task claim

## Summary
API-level lane enforcement. PATCH /tasks/:id {status: doing} rejects out-of-lane claims.

## Done Criteria
- [x] PATCH /tasks/:id {status: doing} rejects if agent lane ≠ task lane
- [x] Error message identifies lane mismatch explicitly
- [x] Tasks with no lane metadata are unaffected
- [x] Harmony claiming a growth task returns HTTP 400

## PR
PR #1076 — 4 tests in lane-validation.test.ts
