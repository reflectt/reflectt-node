# Task: task-1773629272663-wuhrdj9a5 — P0: canvas/query must route to actual agent sessions

## PR
https://github.com/reflectt/reflectt-node/pull/1072

## Changes
Removed all 6 standalone Anthropic API call sites from server.ts:
1. canvas/query general questions → chatManager.sendMessage()
2. voice/input → chatManager.sendMessage()
3. voice/audio → chatManager.sendMessage()
4. gaze "noticed" → template lines only
5. briefing lines → template lines only
6. revenue queries → honest static answer

Zero ANTHROPIC_API_KEY references remain. Zero api.anthropic.com calls.

## Status
PR #1072 merged. Node restarted at commit 4f98f635.
