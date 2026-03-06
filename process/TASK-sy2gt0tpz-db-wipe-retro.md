# TASK-sy2gt0tpz — Post-DB-wipe retrospective brief

Task: task-1772836451003-sy2gt0tpz
Assignee: harmony | Reviewer: sage

## 1. What broke
`insight-promotion.test.ts` contained an unscoped `DELETE FROM tasks` that ran against the production DB on node restart, dropping task count from 1603 → 1. Root cause: no test-mode DB isolation enforced at the process level.

## 2. What shipped
- **PR #728** — startup task-count guard: emits ops alert if `tasks.total` drops unexpectedly after restart.
- **PR #729** — scoped the `DELETE FROM tasks` in `insight-promotion.test.ts` to test-mode DB only.
- **PR #730** — exposes `dbPath` / `REFLECTT_HOME` / `NODE_ENV` in `/health/deploy` for visibility.

## 3. What is still open
- 5 other test files with unscoped DELETEs on other tables — covered by `task-1772836571034-4llnrste9` (@link queue).
- Boot guard: already shipped in PR #730 (`e009b43`) — `process.exit(1)` on non-main branch + production DB path. `task-1772836443932-7d13u87zn` cancelled as duplicate.

## Additional safeguard proposed
Enforce a team norm: any test file touching task/insight tables must declare `testDbPath` or equivalent isolation annotation. Treat missing isolation as a **PR blocker** in code review. @sage @kai to add to PR checklist.
