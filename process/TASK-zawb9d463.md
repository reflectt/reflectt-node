# Task: Task Transition UX
**ID**: task-1771255540884-zawb9d463
**Branch**: link/task-zawb9d463
**Assignee**: link
**Reviewer**: kai

## Summary
Precheck endpoint + auto-defaults + PR helper so agents know what's needed before a transition attempt, instead of getting rejected at gate time.

## Changes
- **New**: `src/taskPrecheck.ts` — runPrecheck() + applyAutoDefaults()
  - Surfaces all required fields before PATCH attempt
  - Auto-fills ETA by priority (P0→~30m, P1→~2h, P2→~4h, etc.)
  - Auto-fills artifact_path from task ID
  - Generates PATCH template for doing/validating transitions
  - QA bundle requirements surfaced proactively as warnings
- **New**: `tools/pr-create.mjs` — PR create helper script
  - Fetches task details, runs precheck, creates standardized PR
  - Usage: `npm run pr:create -- --task <id>`
- **Modified**: `src/server.ts`
  - POST `/tasks/:id/precheck` endpoint
  - Auto-defaults wired into PATCH /tasks/:id (ETA auto-fill)
- **Modified**: `package.json` — `pr:create` script
- **Modified**: `tests/modules.test.ts` — 6 new tests (212 total)
- **Modified**: `public/docs.md` — 1 new route (181/181)

## Done Criteria Mapping
- ✅ API precheck endpoint shows required fields before PATCH
- ✅ Auto-fill default ETA policy when not provided
- ✅ qa_bundle requirements surfaced before validating transition, not at rejection time
- ✅ PR create helper script: npm run pr:create -- --task <id>
