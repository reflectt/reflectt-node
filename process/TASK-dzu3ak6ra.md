# TASK-dzu3ak6ra: P1 — Prod uptime monitor

## What
Production health monitor that checks 4 endpoints every 5 minutes and alerts #ops when anything fails.

## Checks
1. `app.reflectt.ai/overview` — Vercel frontend (5xx = alert)
2. `api.reflectt.ai/api/hosts/{id}/health` — Fly API (5xx = alert, 401 = ok)
3. `api.reflectt.ai/api/hosts/{id}/canvas` — Fly canvas endpoint
4. Node health + canvas data freshness (stale > 10min = alert)

## Implementation
- `scripts/uptime-monitor.mjs` — standalone script, no dependencies
- Posts to #ops via `POST /chat/messages` when checks fail
- LaunchAgent plist at `~/Library/LaunchAgents/com.reflectt.uptime-monitor.plist`
- Runs every 300s, RunAtLoad=true
- 15s timeout per check

## Verification
- All 4 checks pass on healthy prod
- Simulated Fly failure → alert posted to #ops ✅
- LaunchAgent loaded and running ✅
