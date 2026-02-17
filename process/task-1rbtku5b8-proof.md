# Dogfood Boot — Proof of Execution

**Task:** task-1771218962412-1rbtku5b8
**Branch:** link/dogfood-boot
**Script:** tools/dogfood-boot.sh

## What it does
Single command boots an isolated reflectt-node instance and verifies the full E2E stack:

1. **Clean build** — runs `npm run build` (real tsc, not faked)
2. **Build freshness** — checks ALL src/*.ts files against dist/index.js (not just server.ts)
3. **Isolated start** — uses temp dir for REFLECTT_HOME (no shared DB with running instance)
4. **Watchdog disabled** — IDLE_NUDGE_ENABLED=false etc. to prevent noise during test
5. **13 endpoint checks**: health, task CRUD, chat post/list, inbox, presence, health/agents, docs

## Run output
```
PORT=4447 ./tools/dogfood-boot.sh

🔧 reflectt-node dogfood boot
   Port: 4447

── Build ──
  ✅ TypeScript build (tsc)
  ✅ Build freshness (dist up to date)

── Server start ──
  ✅ Server started

── Endpoint checks ──
  ✅ GET /health
  ✅ POST /tasks
  ✅ GET /tasks/:id
  ✅ GET /tasks (list)
  ✅ POST /chat/messages
  ✅ GET /chat/messages
  ✅ GET /inbox/link
  ✅ POST /presence/dogfood
  ✅ GET /health/agents
  ✅ GET /docs

── Result ──
   13/13 passed, 0 failed
🟢 All checks passed
```

## Reviewer rejection fixes
- Build check: real `npm run build` with exit code check (not hard-coded pass)
- Staleness: `find src -name '*.ts' -newer dist/index.js` (all source files, not just server.ts)
- Isolation: `REFLECTT_HOME=$tmpdir` (clean DB, no shared state with running instance)
- Proof artifact: this file exists in the branch
