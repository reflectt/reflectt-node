# Process: task-1773609200822-mvyenno83 — canvas/query relay queue

## Changes (node)
- src/cloud.ts: pollCanvasQueryQueue() — polls every 5s on approval sync timer
  - GET /api/hosts/:id/canvas/query-queue → fetch queued queries
  - POST /canvas/query locally for each → response arrives via canvas_message SSE
  - POST /api/hosts/:id/canvas/query-queue to ACK processed queryIds

## Changes (cloud)
- apps/api/src/presence-relay.ts: queueCanvasQuery(), handleGetCanvasQueryQueue(), handleAckCanvasQueries()
- apps/api/src/index.ts: relay queue fallback when nodeUrl===null; two new routes (GET+POST /canvas/query-queue)

## AC
- [x] canvas/query returns 202+{queued:true} for NAT-behind nodes (no 503)
- [x] node polls every 5s and processes queries locally → canvas_message SSE → browser
- [x] managed hosts with direct nodeUrl are unaffected (proxy path unchanged)
