# TASK-lo5yiqjdd — POST /canvas/briefing (The Briefing)

**Status:** validating  
**PR:** https://github.com/reflectt/reflectt-node/pull/973  
**Commit:** fd9fa8e

## What shipped
`POST /canvas/briefing` returns immediately with agent roster, then fires N `canvas_expression { _briefing: true }` events staggered 700ms apart. LLM one-liner per agent (claude-haiku-4-5); template fallback per state. 30s idempotency window.

## Response shape
```json
{ "agents": [{ "name": "link", "voiceLine": "Shipping the backend.", "state": "working", "identityColor": "#60a5fa", "task": "canvas Hollywood stack" }], "totalMs": 2100 }
```
Then pulse stream receives `canvas_expression._briefing=true` events in sequence.
