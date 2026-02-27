# Docker Devkit

**Task:** `task-1772209309725-20q946ru8`  
**PR:** [#451](https://github.com/reflectt/reflectt-node/pull/451)  
**Branch:** `link/task-20q946ru8`

## Done Criteria → Evidence

| Criteria | Evidence |
|----------|----------|
| Dockerfile + docker-compose.yml committed | PR #451 adds both files |
| docker-compose up yields /health ok | `{"status":"ok","version":"0.1.0","uptime_seconds":12}` |
| README section with commands + env vars | Docker section with quick start, env var table, gateway config |
| Proof: container logs + curl output | Clean startup logs, 0 tasks, 0 messages, /dashboard 200 |

## Architecture

- **Build stage** (node:22-slim): python3/make/g++ for better-sqlite3, full npm ci, tsc build
- **Runtime stage** (node:22-slim): production deps only, copies dist/ + public/ + defaults/ + templates/
- **Data volume**: /data (SQLite DB, config, experiments) — persists across container restarts
- **Health check**: GET /health every 30s, 10s start period, 3 retries
