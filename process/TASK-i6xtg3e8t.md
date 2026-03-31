# Review: task-1773377932146-i6xtg3e8t — Canvas wipe on host disconnect

## Summary
Stale canvas state eliminated via two complementary mechanisms (belt+suspenders).

## Artifacts
- **PR #958** (reflectt-cloud, merged): `getFreshCanvasState()` 5-min TTL wraps all `canvasStore.get()` reads; stale state evicted + SSE notified. `POST /api/hosts/:hostId/canvas/clear` endpoint added.
- **PR #923** (reflectt-node, merged): `stopCloudIntegration()` fires `POST /canvas/clear` on clean shutdown.

## Acceptance Criteria
- [x] Canvas state cleared on clean node disconnect (PR #923 — `stopCloudIntegration` fires clear)
- [x] Canvas state expires automatically after 5 minutes of stale data (PR #958 — `CANVAS_STALE_TTL_MS`)
- [x] SSE subscribers notified on clear (PR #958 — `notifyCanvasSubscribers`)
- [x] Both deployed to Fly

## Commits
- reflectt-cloud: `8a805d4` (PR #958)
- reflectt-node: `352b3f2` (PR #923)

## Caveats
None. Both PRs clean and merged.
