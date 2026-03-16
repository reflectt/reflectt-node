# P0: canvas_message / canvas_push never reached cloud browsers

## Root Cause
POST /canvas/query only emitted via eventBus.emit() — this forwards to LOCAL SSE subscribers only
(browsers connected directly at 127.0.0.1:4445). Browsers on app.reflectt.ai connect via
api.reflectt.ai (Fly), which receives events only via queueCanvasPushEvent() → syncCanvas() relay.

Same bug affected POST /canvas/push and POST /canvas/artifact — all three missed the relay.

## Fix
Added queueCanvasPushEvent() calls after eventBus.emit() in:
- POST /canvas/query  → canvas_message relay
- POST /canvas/push   → canvas_push relay  
- POST /canvas/artifact → canvas_artifact relay

## Impact
All real users on app.reflectt.ai now receive canvas_message (query response cards),
canvas_push (agent utterances, work_released), and canvas_artifact (proof cards).

Ryan: "canvas still isn't usable for anyone" — this was the root cause.
