# Health Endpoints Operator Cheat Sheet

Compact reference for fast triage.

Base URL: `http://127.0.0.1:4445`

## Endpoint map

| Endpoint | Use it for | Key fields |
|---|---|---|
| `GET /health` | Basic service liveness | `status`, `tasks`, `chat`, `inbox`, `timestamp` |
| `GET /health/system` | Process/runtime health | uptime, performance/error signals |
| `GET /health/team` | Rich team context | blockers, overlap, compliance context |
| `GET /health/agents` | Compact per-agent state | `last_seen`, `active_task`, `heartbeat_age_ms`, `state` |
| `GET /health/compliance` | SLA/cadence compliance | incident + summary compliance metrics |
| `GET /health/idle-nudge/debug` | Nudge suppression/debug | suppression reason, cooldown indicators |

## Quick commands

```bash
curl -s http://127.0.0.1:4445/health
curl -s http://127.0.0.1:4445/health/system
curl -s http://127.0.0.1:4445/health/team
curl -s http://127.0.0.1:4445/health/agents
curl -s http://127.0.0.1:4445/health/compliance
curl -s http://127.0.0.1:4445/health/idle-nudge/debug
```

## Dry-run watchdog checks

```bash
curl -s -X POST 'http://127.0.0.1:4445/health/idle-nudge/tick?dryRun=true'
curl -s -X POST 'http://127.0.0.1:4445/health/cadence-watchdog/tick?dryRun=true'
curl -s -X POST 'http://127.0.0.1:4445/health/mention-rescue/tick?dryRun=true'
```

Use dry-run first when alerts look noisy.

## Common playbook links

- `docs/HEALTH_ENDPOINTS_MAP.md`
- `docs/WATCHDOG_BEHAVIOR_EXPLAINER.md`
- `docs/KNOWN_ISSUES.md`

## 60-second triage flow

1. `/health` → process up?
2. `/health/system` → runtime degradation?
3. `/health/agents` → who is stale/blocked?
4. `/health/compliance` → true SLA breach or expected wait?
5. `/health/idle-nudge/debug` + dry-run ticks → suppress/noise vs real issue.
