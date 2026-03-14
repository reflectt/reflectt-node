# TASK-3z83jzley — Cross-Device Continuity Snapshot

## What
`GET /canvas/session/snapshot` — serializes minimal resumable session state for cross-device handoff.

## Spec
`workspace-pixel/design/interface-os-v0-continuity.html` (@pixel)

## Fields transferred
- agent_id, canvas_state, presence_state, active_task, active_decision, content_snapshot
- handoff.summary, handoff.stream_in_progress, handoff.sensor_consent_transferred (always false)

## NOT transferred (per spec)
- in-progress streams (target joins at next complete block)
- sensor consent (per-device, must re-grant)
- full run history

## Consumer
@pixel (handoff banner web UI), @swift (iOS), @kotlin (Android)
