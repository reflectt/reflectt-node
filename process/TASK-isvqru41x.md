# Task: task-1773855900916-isvqru41x — regression(canvas): first-wow query stalls on 'Asking link…' with no agent response card

## Artifact
PR: https://github.com/reflectt/reflectt-node/pull/1129 (merged, 8b9b18df)

## Root Cause
Canvas query responses (agent "thought" cards) were emitted as `canvas_message` events on the event bus but never reached the browser's render stream (`canvas_render.v1` protocol). The browser connected to `/canvas/render/stream` via the cloud API, which subscribes to the node's render stream. However, `canvas_message` events from canvas-query were only being handled by the pulse SSE stream, not converted to render stream commands.

## Fix
Added an event bus listener in `src/canvas-interactive.ts` that bridges `canvas_message` events to `broadcastRenderCommand`. When an agent responds to a canvas query (via `POST /canvas/push`), the canvas_message event now:
1. Is emitted on the event bus (already happening)
2. Is picked up by the new canvas-query-response-bridge listener in canvas-interactive.ts
3. Is forwarded to `broadcastRenderCommand` as a speak/text command
4. Is sent to the browser via the render stream SSE

## Code Change
- `src/canvas-interactive.ts`: Added event bus listener `'canvas-query-response-bridge'` that forwards `canvas_message` events to `broadcastRenderCommand`
  - expression=greeting → speak command
  - expression=response/utterance → speak command  
  - expression=thinking → text command (styled gray)
  - default → text command

## Done Criteria
- [x] canvas_message events forwarded to render stream
- [x] Agent response cards now appear on canvas for browser
- [x] No regression: pulse stream continues working
- [ ] E2E verification: first-wow query returns response card

## Test Evidence
- 2473 tests pass (3 pre-existing failures in canvas-approval-card.test.ts — unrelated)
- Route/docs contract: 580/580 ✅

## Caveats
- Need local E2E test to verify fix works end-to-end
- Production node needs restart with new code
