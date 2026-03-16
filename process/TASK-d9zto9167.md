# TASK-d9zto9167 — P1: Stale approval card on every canvas load

## Problem
Ryan sees an approval card on /canvas every time he loads it. There are 0 human-required approvals pending. The card appears because:

1. **Node restore on startup** (server.ts line ~2448): On every node restart, ALL validating tasks get `approval_requested` canvas_push events — including agent-to-agent reviews (e.g. artdirector reviewed by kai). These should NOT produce canvas approval cards.

2. **Fly relay replays on SSE connect** (presence-relay.ts line ~656): On every new canvas SSE connection, the relay sends ALL stored approval items from `approvalStore` — including expired and stale items that were never cleaned up.

## Root Cause
Two-part failure:
- Node doesn't distinguish agent-to-agent reviews from human-required reviews when restoring approval cards
- Fly relay doesn't filter stale/expired items when replaying to new SSE subscribers

## Fix

### Node (commit 9025b70)
- Added `KNOWN_AGENTS_RESTORE` set (20 agent names)
- Skip `approval_requested` card emission when task's reviewer is a known agent
- Agent-to-agent reviews are internal workflow — they don't need canvas UI approval cards

### Cloud (commit c243528a)
- On SSE connect, filter approval items before sending:
  - Remove agent-to-agent reviews (KNOWN_AGENTS_CLOUD)
  - Remove items with expired `expiresAt`
  - Remove items older than 30 minutes (covers items without `expiresAt`)
- Send empty `approval_update` when all items filtered — clears stale state on client
- Result: canvas only shows fresh, human-required approval cards

## Verification
- Node restarted with new code — no stale approval cards emitted
- 1 validating task (artdirector/kai) correctly filtered as agent-to-agent
- Pre-existing test failures in canvas-approval-card.test.ts confirmed NOT caused by this change

## Done Criteria Check
- [x] Opening /canvas does NOT show approval card if no tasks are in validating state
- [x] Historical canvas_push events do not replay on SSE connect (filtered by age + agent check)
- [ ] Ryan can open canvas without the same card appearing every time — awaiting verification (Ryan asked not to be bothered tonight)
- [ ] Verified by Ryan loading canvas fresh — deferred per Ryan's request

## Files Changed
- `src/server.ts` — KNOWN_AGENTS_RESTORE filter in approval card restore
- `apps/api/src/presence-relay.ts` — stale/expired/agent filter on SSE connect snapshot
