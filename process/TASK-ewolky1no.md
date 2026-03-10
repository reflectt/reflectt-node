# TASK ewolky1no — restart continuity fix

Canonical QA artifact for task-1773092448539-ewolky1no.

## Boundary
- fixed: restart continuity / active-work presence hydration
- fixed: routine presence updates wiping the active task pointer
- not proven: DB-level deletion or auto-close of doing rows on restart

## PR
- PR #866 — https://github.com/reflectt/reflectt-node/pull/866
- Commit: fac341c

## Changed files
- `src/presence.ts`
- `src/server.ts`
- `tests/presence-restart-continuity.test.ts`
- `process/TASK-task-1773092448539-ewolky1no-restart-continuity-fix.md` (full writeup)

## Verification
- Passed: `npm test -- --run tests/presence-restart-continuity.test.ts tests/presence-seed.test.ts tests/presence-stale-state.test.ts`
- Known unrelated baseline issue: `npm run build` still fails on external dependency/type setup (`@browserbasehq/stagehand`, `@fastify/multipart`).

## Summary
This task should be reviewed as a **restart continuity fix**. If someone still wants the stronger claim investigated, DB-level deletion / auto-close on restart should be separate follow-up work with its own reproducer and evidence trail.
