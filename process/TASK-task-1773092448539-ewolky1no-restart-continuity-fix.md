# TASK task-1773092448539-ewolky1no — restart continuity fix

## Scope boundary

What this change proves and fixes:
- **Validated:** restart continuity / resume-path failure for active work.
- **Fixed:** presence hydration + routine presence updates could make an in-flight `doing` task lose its task pointer after restart or wake-up.
- **Not proven:** DB-level deletion or auto-close of `doing` task rows on restart.

This artifact should be read as a **restart continuity fix**, not as proof that restart deletes task rows.

## Root cause

Two continuity gaps were enough to create the observed "dropped work" symptom:

1. **Cold start presence seeding only marked agents idle**
   - `src/presence.ts` previously seeded from recent activity but did not restore the active `doing` task pointer from SQLite.
   - After restart, an agent with a live `doing` row could come back as generic idle/empty presence until they posted again.

2. **Routine presence updates could clobber the task pointer**
   - `updatePresence(agent, 'working')` overwrote `task` with `undefined`.
   - That meant normal wake/heartbeat/task-status updates could erase the active-task pointer even when the `doing` row still existed in SQLite.

## Fix shipped

### `src/presence.ts`
- Exported `PresenceManager` so restart behavior can be tested directly.
- Added task-aware startup hydration:
  - latest local `doing` row per assignee is now seeded into presence as `status: working` + `task: <id>`.
  - local active task rows no longer depend on TEAM-ROLES roster sync to survive restart.
- Added task-aware lookup during presence updates:
  - `task: string` sets the pointer explicitly.
  - `task: null` clears it explicitly.
  - omitted `task` preserves existing pointer and hydrates from the board when needed.
- Added `clearAll()` test helper.

### `src/server.ts`
- Task lifecycle presence updates now pass explicit task intent:
  - `doing` → `updatePresence(..., 'working', task.id)`
  - `blocked` → `updatePresence(..., 'blocked', task.id)`
  - `validating` → `updatePresence(..., 'reviewing', task.id)`
  - `done` → `updatePresence(..., 'working', null)` to clear the pointer intentionally
- `/presence/:agent` now accepts `task: null` as an explicit clear.

## Evidence

### Tests added
- `tests/presence-restart-continuity.test.ts`
  - hydrates a `doing` task from SQLite on cold start
  - proves routine `updatePresence(..., 'working')` no longer wipes the task pointer
  - proves explicit `null` still clears the pointer when work is actually finished

### Tests run
```bash
npm test -- --run tests/presence-restart-continuity.test.ts tests/presence-seed.test.ts tests/presence-stale-state.test.ts
```

Result: **pass** (`8 passed`)

### Notes
- `npm run build` still fails on unrelated baseline dependency/type issues in this branch (`@browserbasehq/stagehand`, `@fastify/multipart` typing). Not caused by this fix.

## Conclusion

This closes the narrow failure mode where restart/wake behavior made active work look dropped or idle-unsafe.

It does **not** establish that restart deletes `doing` rows from the DB. If that stronger claim still matters, it should stay open as separate follow-up work with its own reproducer and evidence trail.
