# Task: Guardrail Automation — Synthetic Probe + Auto-Restart

**Task ID:** task-1771877001942-4r3ns56hu  
**Branch:** link/task-4r3ns56hu  

## Summary

Standalone synthetic health probe that monitors reflectt-node and auto-restarts on sustained failure. Addresses recurring API timeout/hang issues that crash-restart alone doesn't catch.

## Architecture

```
[com.reflectt.probe LaunchAgent]
    │
    ├── Every 30s: check /health, /tasks?limit=1, /chat/noise-budget
    │
    ├── All OK → reset failure counter
    │
    ├── Critical failure → increment counter
    │   └── 3 consecutive → launchctl kickstart -k (auto-restart)
    │
    └── Guard rails:
        ├── Max 5 restarts/hour (prevents restart loop)
        ├── Backoff between attempts
        └── Alert logging with root-cause context
```

## Endpoints Probed

| Endpoint | Critical | Validates |
|----------|----------|-----------|
| `/health` | ✅ | `status === "ok"` |
| `/tasks?limit=1` | ✅ | `success === true` or `tasks` array present |
| `/chat/noise-budget` | ❌ | `success === true` |

## Restart Policy

- **Trigger:** 3 consecutive critical endpoint failures
- **Method:** `launchctl kickstart -k gui/$UID/com.reflectt.node`
- **Guard:** Max 5 restarts per rolling hour (timestamps pruned >1h)
- **Logging:** JSON log to `logs/service-probe.log` with timestamps, latencies, failure reasons

## Files

- `src/service-probe.ts` — Probe logic, restart, logging (~250 lines)
- `config/com.reflectt.probe.plist` — LaunchAgent config
- `tests/service-probe.test.ts` — 10 tests: endpoint checks, restart guards, validators

## Deployment

```bash
# Build
npm run build

# Install LaunchAgent
cp config/com.reflectt.probe.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.reflectt.probe.plist

# Verify
launchctl list | grep reflectt.probe

# Disable (rollback)
launchctl unload ~/Library/LaunchAgents/com.reflectt.probe.plist
```

## Rollback Toggle

- Unload the LaunchAgent to disable probe entirely
- Set `--dry-run` flag in plist to log-only mode (no restarts)
- Set `--max-retries 999` to effectively disable auto-restart
