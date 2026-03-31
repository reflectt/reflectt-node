# TASK-5mlkqadzh — voice API backend

## What
POST /voice/input + GET /voice/session/:id/events — SSE backend for pixel's voice UI.

## Files
- src/voice-sessions.ts — in-memory session store + event bus + processing pipeline
- src/server.ts — HTTP endpoints wired
- tests/voice-sessions.test.ts — 19 unit tests
- public/docs.md — endpoints documented

## Endpoint contract (matches use-voice-input.ts schema)
POST /voice/input: { agentId, transcript } → { sessionId }
GET /voice/session/:id/events: SSE, events: transcript.final | agent.thinking | agent.done | tts.ready | error | session.end

## Notes
- MVP: transcript text only (no audio blob STT yet)
- Agent responder is a stub — real LLM call is next iteration
- TTS synthesis via synthesizeTts injector (wirable to ElevenLabs)
- Session TTL: 10 min; pruned on next create
- pixel: swap useBackend=false → true in useVoiceInput to wire end-to-end
