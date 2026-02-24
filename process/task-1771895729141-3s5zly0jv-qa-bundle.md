# QA Bundle — task-1771895729141-3s5zly0jv

## Summary
Chat previously loaded the full `messages.jsonl` history into an in-memory array on startup (94k msgs observed), causing high RSS (~395MB) and API timeouts.

This change makes SQLite the source of truth for all chat read paths and keeps only a **bounded** in-memory cache for realtime subscriptions / warm start.

## Changes
- `src/chat.ts`
  - Warm cache from SQLite with **time window + cap** (default: last 24h, max 5k messages)
  - `getMessages`, `search`, `getChannels`, `getThread`, `replyCount` now query SQLite using `WHERE/ORDER/LIMIT`
  - Reactions/edit/delete update SQLite + audit JSONL, and update cache copy if present
  - Added `getStats().cachedMessages/cacheWindowMs/maxCachedMessages`
- `src/assignment.ts`
  - Tests are now hermetic: `loadAgentRoles()` ignores `~/.reflectt/TEAM-ROLES.yaml` when `NODE_ENV=test` or `VITEST` is set.
    - Fixes local-config-dependent reviewer scoring tests.

## Evidence / Proof
- Insight evidence: startup previously hydrated ~94k messages; RSS ~395MB; timeouts on endpoints.
- Now: startup only hydrates bounded cache (24h/5k). Endpoints query SQLite directly.
- Tests: `npm test` → **287 passed**.

## How to Validate
1. Start node with a large chat history.
2. Hit:
   - `GET /chat/messages?limit=200`
   - `GET /chat/channels`
   - `GET /chat/thread/:id` (if available)
   - `GET /chat/search?q=...` (if available)
3. Confirm:
   - responses return quickly
   - process RSS does not scale with total historical messages

## Caveats
- Cache is a bounded warm-start/subscription buffer only; it is **not** intended to be a full history store.
- If we need a different default cache window/cap, we should expose configuration.
