# QA Bundle — task-1771943679478-lskbtmcb6

## Summary
Under-5-min onboarding: starter team template + team doctor + quickstart guide.

## Changes
- `src/team-doctor.ts` — 6 diagnostic checks (node, db, agents, gateway, model auth, chat)
- `src/starter-team.ts` — scaffold default agents (builder + ops) with SOUL.md + AGENTS.md
- `src/server.ts` — wired `GET /health/team/doctor` + `POST /team/starter` endpoints
- `docs/QUICKSTART.md` — zero-to-chatting in ~4 min guide with timed reference table
- `tests/team-doctor.test.ts` — 5 tests
- `tests/starter-team.test.ts` — 3 tests

## Evidence
- `npm test` → 52 files, 869 passed, 1 skipped
- `npm run build` passes (tsc)

## How to Validate
1. Start reflectt-node
2. `curl -X POST http://127.0.0.1:4445/team/starter` → creates builder + ops agents
3. `curl http://127.0.0.1:4445/health/team/doctor` → returns diagnostic report
4. Follow docs/QUICKSTART.md from scratch on a clean machine

## Caveats
- Starter team uses default agent templates; users will want to customize SOUL.md
- Team doctor checks env vars for gateway/model auth; if running without OpenClaw gateway, those checks will report fail/warn (expected)
