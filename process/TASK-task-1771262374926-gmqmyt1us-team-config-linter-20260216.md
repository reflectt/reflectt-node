# TASK task-1771262374926-gmqmyt1us — Team config linter

## Scope shipped in this slice
Implemented a team-config linter and health endpoint for `~/.reflectt` team files:

- `TEAM.md`
- `TEAM-ROLES.yaml`
- `TEAM-STANDARDS.md`

## Code changes
- `src/team-config.ts` (new)
  - validates presence/readability of team files
  - checks required TEAM.md section tokens (`mission`, `principle`, `role`, `work`)
  - parses role names from `TEAM-ROLES.yaml` (lightweight YAML scan)
  - emits warnings for missing/malformed files
  - emits **error** if assignment-engine role names are missing from TEAM-ROLES config
  - stores latest validation result for API access
  - runs watch-mode revalidation on file change under `~/.reflectt`
- `src/index.ts`
  - starts linter on boot (`startTeamConfigLinter()`)
  - stops watcher on shutdown (`stopTeamConfigLinter()`)
- `src/server.ts`
  - new `GET /team/health` endpoint exposing linter status
- `public/docs.md`
  - route docs entry for `GET /team/health`
- `tests/api.test.ts`
  - integration test for `/team/health` payload contract

## Validation
- `npm run -s build` ✅
- `npm test -- -t "team config linter status payload"` ✅
- `npm run -s check:route-docs-contract` ✅

## Notes
This implements startup validation + file-change revalidation and exposes status via API without blocking startup on warnings.
