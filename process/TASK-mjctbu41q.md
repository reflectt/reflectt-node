# TASK-mjctbu41q — Streaming /canvas/gaze

**Status:** validating  
**PR:** https://github.com/reflectt/reflectt-node/pull/973  
**Commit:** fd9fa8e

## What shipped
`POST /canvas/gaze { stream: true }` returns SSE. Tokens arrive from Anthropic streaming API and fire `canvas_expression { _gaze: true, _stream: true }` on pulse stream as they arrive. Final event adds `_streamFinal: true`.

## Wire format
```
// Per token:
{ _gaze: true, _stream: true, channels: { typography: { text: "You caught me thi..." } } }
// Final:
{ _gaze: true, _streamFinal: true, channels: { voice: "...", visual: {...}, typography: {...} } }
```
Non-streaming default unchanged. Template fallback always available.
