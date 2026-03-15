# Task: task-1773605754615-i2vj55bqg — fix(node): canvas session continuity — persist to SQLite

## Artifact
PR: https://github.com/reflectt/reflectt-node/pull/1058 (pending)

## Changes
- src/db.ts: migration v26 — canvas_sessions table (session_id, role, content, ts)
- src/server.ts:
  - getCanvasSession: reads from SQLite on Map cache miss; prunes stale rows on read
  - pushCanvasSession: write-through to SQLite after updating in-memory Map
  - All 5 card types now store session turns: tasks, revenue/info, onboarding, hosts, LLM info
- tests/canvas-session-sqlite.test.ts: migration test, insert+query test, TTL prune test

## AC
- [x] canvas_sessions SQLite table created with migration v26
- [x] pushCanvasSession writes to DB (write-through)
- [x] getCanvasSession reads from DB on Map cache miss
- [x] TTL cleanup prunes rows older than 30 min (on read)
- [x] All card types store text summary as assistant turn
- [x] Session history survives node restart — verified by DB tests
