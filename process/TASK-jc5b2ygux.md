# Task: fix(usage): emit usage events for OpenClaw-hosted agents

**Task ID:** task-1773580171487-jc5b2ygux  
**PR:** https://github.com/reflectt/reflectt-node/pull/1029  
**Commit:** cfd722263194dc064f0e4c4dcd38b9da23cfa7c8  
**Closes:** reflectt/reflectt-cloud#681

## Problem

16+ agents running via OpenClaw report $0 in the cloud usage dashboard
because they never call `POST /usage/report`. Token/cost data IS stored
in `~/.openclaw/agents/*/sessions/sessions.json` — just never read.

## What was built

`src/openclaw-usage-sync.ts` — periodic sync job that reads OpenClaw
agent session files and ingests token/cost data into `model_usage`.

### Implementation

- Walks `~/.openclaw/agents/*/sessions/sessions.json` for every agent
- Reads per-session aggregated tokens + model/provider (no JSONL parsing)
- Deduplicates via `api_source = 'openclaw:{sessionId}'`
- Skips sessions with 0 tokens or missing model/sessionId
- Estimates cost via existing `estimateCost()`
- Runs at startup (10s delay) + every 5m

### New endpoint

`POST /usage/sync/openclaw` — on-demand trigger

### Tests

8 unit tests in `openclaw-usage-sync.test.ts` — all passing.

## Verification

```
npm test → 2249 passing (4 pre-existing failures on main unrelated to this PR)
node tools/check-route-docs-contract.mjs → ✅ 548/548 routes documented
```
