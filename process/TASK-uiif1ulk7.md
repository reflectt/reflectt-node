# TASK-uiif1ulk7 — Auto ghost trails on state transitions

**Status:** validating  
**PR:** https://github.com/reflectt/reflectt-node/pull/973  
**Commit:** fd9fa8e

## What shipped
`POST /canvas/state` now auto-fires `canvas_expression { _ghost: true }` on every state transition. Zero explicit `POST /canvas/express` call needed.

## Wire format
```json
{ "agentId": "link", "identityColor": "#60a5fa", "_ghost": true, "_ghostIntensity": 0.65,
  "channels": { "visual": { "flash": "#60a5fa", "particles": "drift" }, "narrative": "link → thinking" } }
```
`_ghostIntensity` range: 0.25 (floor) to 0.9 (urgent).
