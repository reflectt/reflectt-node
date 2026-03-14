# TASK-0o0jyfrau — canvas_milestone cinematic beat

**Status:** validating  
**PR:** https://github.com/reflectt/reflectt-node/pull/976  
**Commit:** 0acf8be

## What shipped
Server auto-fires `canvas_milestone` on every task approval (validating→done).

## Intensity formula
- Age score: `min(ageMs / 30min, 1.0)` — 30min+ task = max age score
- Doing bonus: `min(doingMs / 1h, 0.3)` — 1h+ in doing adds 0.3
- Final: `min(ageScore * 0.7 + doingScore + 0.15, 1.0)` — minimum 0.15

## Payload
```json
{ "agentId": "link", "title": "task title", "taskId": "task-...", "intensity": 0.85,
  "ageMs": 1800000, "milestoneColor": "#60a5fa",
  "channels": { "visual": { "flash": "#60a5fa", "particles": "surge" }, "narrative": "link shipped: ..." } }
```

## Client integration
PR #1134 (pixel, merged): `canvas_milestone` with intensity > 0.7 → supernova bell chord + title dissolution.  
This PR provides the server-side trigger — every task close rings the canvas.
