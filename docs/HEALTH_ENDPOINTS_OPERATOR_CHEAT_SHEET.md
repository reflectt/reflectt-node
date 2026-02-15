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

## Expected response snippets

### `/health` (trimmed)

```json
{
  "status": "ok",
  "openclaw": "not configured",
  "chat": {
    "totalMessages": 1234,
    "rooms": 1,
    "subscribers": 0
  },
  "tasks": {
    "total": 42,
    "byStatus": {
      "todo": 3,
      "doing": 5,
      "blocked": 1,
      "validating": 2,
      "done": 31
    }
  },
  "inbox": {
    "agents": 7,
    "defaultSubscriptions": ["general", "decisions", "problems", "shipping"]
  },
  "timestamp": 1771158611630
}
```

### `/health/agents` (trimmed)

```json
{
  "agents": [
    {
      "agent": "kai",
      "last_seen": 1771158603451,
      "active_task": null,
      "heartbeat_age_ms": 0,
      "last_shipped_at": 1771158600504,
      "shipped_age_ms": 0,
      "stale_reason": null,
      "idle_with_active_task": false,
      "state": "healthy"
    },
    {
      "agent": "spark",
      "last_seen": 1771158551248,
      "active_task": "watchdog noise suppression hardening pass",
      "heartbeat_age_ms": 60000,
      "last_shipped_at": 1771158551248,
      "shipped_age_ms": 60000,
      "stale_reason": null,
      "idle_with_active_task": false,
      "state": "healthy"
    }
  ]
}
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
