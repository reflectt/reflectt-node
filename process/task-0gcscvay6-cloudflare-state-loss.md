# task-1772226568338-0gcscvay6 — Cloudflare Workers State Loss

## Root Cause
reflectt-node stores all persistent state on the local filesystem (`~/.reflectt/data/`):
- SQLite DB: `reflectt.db`
- JSONL files: tasks, history, comments, recurring tasks, reflections, inbox

Cloudflare Workers have ephemeral filesystems that wipe on every cold start (~30min idle).

## Evidence
- `src/config.ts:30-31`: `REFLECTT_HOME = ~/.reflectt`, `DATA_DIR = ~/.reflectt/data`
- `src/db.ts:16`: SQLite at `DATA_DIR/reflectt.db`
- `src/tasks.ts`: All task CRUD writes to JSONL in DATA_DIR
- Kai observed full state loss after ~30min idle on CF Workers

## Fix
PR #479 — Added "Deployment Requirements" section to README.md documenting:
- Supported: VPS, Docker, bare metal, Raspberry Pi
- Not supported: Cloudflare Workers, Lambda, any serverless platform
- Explanation of why persistent storage is required

## Future
Storage abstraction layer for serverless support would be a separate, larger effort.
