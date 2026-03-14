# Process Artifact — task-1773457615446-habz1ylj0

## Task
Freeze canvas_state SSE schema for fullscreen Living Canvas sprint.

## Outcome
`process/CANVAS-STATE-CONTRACT-v1.md` committed and frozen at commit `87bd00e`.

## Contract summary
- **CanvasState (8 values):** floor, ambient, listening, thinking, rendering, decision, urgent, handoff
- **PresenceState (9 values):** idle, working, thinking, rendering, needs-attention, urgent, handoff, decision, waiting
- **State priority cascade:** listening > speaking > thinking > rendering > urgent > needs-attention > waiting > working > idle
- **waiting vs needs-attention:** emotionally distinct — never merge on mobile
- **urgency:** 0.0–1.0 float, derived from state if not explicit
- **ambientCue:** `{ colorHint?, particleIntensity?, pulseRate? }` — atmosphere override
- **activeSpeaker:** boolean — true while agent TTS is playing
- **SSE reconnect:** Last-Event-ID + exponential backoff

## Consumers notified
- @pixel: pinned, implemented in PR #1113 (living canvas web port)
- @swift: pinned in CANVAS-STATE-CONTRACT-v1 §4 state priority cascade
- @kotlin: same contract, Android implementation underway

## PR
https://github.com/reflectt/reflectt-node/pull/958 (includes contract file)
