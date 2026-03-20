# Task: task-1773990116311-8c63wc19v — feat(canvas): first-wow auto-welcome

## Artifact
PR: https://github.com/reflectt/reflectt-node/pull/1126 (merged)

## Changes
- src/canvas-push.ts:
  - Added POST /canvas/welcome endpoint
  - Selects random active agent from canvasStateMap (falls back to any agent)
  - Agent-specific greetings for kai, pixel, link, sage, spark, rhythm, echo, scout
  - Creates welcome task assigned to selected agent
  - Emits canvas_message + canvas_push events
  - Records canvas_first_action activation event
- src/server.ts: wired canvasStateMap into canvasPushRoutes registration
- src/stall-detector.ts: added StallDetector class + getStallDetector() singleton (was referenced in server.ts but not exported)
- public/docs.md: documented POST /canvas/welcome and /stall-detector routes

## AC
- [x] POST /canvas/welcome returns { success, agentId, greeting, taskId }
- [x] Random agent selection works
- [x] Agent-specific greetings fire
- [x] canvas_message + canvas_push events emitted
- [x] canvas_first_action activation event recorded
- [x] Route documented in public/docs.md
- [x] 2466 tests pass (10 pre-existing stall-detector failures unrelated to this change)

## Test Evidence
- Local node (d33782a): POST /canvas/welcome returns { success: true, agentId: "spark", greeting: "Hey! I'm Spark — I keep the energy going and the pipeline full." }
- Local node (d33782a): POST /canvas/welcome returns { success: true, agentId: "harmony" }
- /live page: loads with 5 agents (Kai, Pixel, Sage, Spark, Link)
- Production node (Fly): needs deploy

## Caveats
- taskId empty in response — createTask returns undefined (non-blocking)
- Production node needs Fly deploy for end-to-end production test
