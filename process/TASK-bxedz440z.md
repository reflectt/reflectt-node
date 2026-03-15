# Task: feat(tasks): blocked-external flag

**Task ID:** task-1773573105946-bxedz440z  
**PR:** https://github.com/reflectt/reflectt-node/pull/1031  
**Commit:** 436ce25a91381033ab9b38091be6173341e89766

## Problem

Tasks waiting on human-provided credentials (Apple Developer, X API keys) were
triggering suggest-close alerts and ready-queue warnings — falsely implying
they were abandoned. Examples: task-1773059181475 (Swift iOS) accumulated 6+
false-positive auto-requeue events.

## Changes

**boardHealthWorker.ts:**
- `findAbandonedTasks`: skip tasks where `metadata.blocked_external === true`
- Board health digest: partition blocked into 'blocked' + 'blocked-external',
  show separate count + list each externally-blocked task with its reason

**server.ts:**
- `POST /tasks/:id/block-external` — mark task externally blocked (required reason)
- `POST /tasks/:id/unblock-external` — remove the flag when dependency resolves

## Verification

```
npm test → 2268 passing (19 new tests)
node tools/check-route-docs-contract.mjs → ✅ 549/549 routes documented
```
