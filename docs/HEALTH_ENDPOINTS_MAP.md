# Health Endpoints Map

Purpose: clarify which health endpoint to use for which operational question.

Base URL: `http://127.0.0.1:4445`

---

## Quick selector

| If you need to know… | Use endpoint |
|---|---|
| Is the service alive at all? | `GET /health` |
| System uptime/perf/error posture | `GET /health/system` |
| Team-wide blockers + overlap context | `GET /health/team` |
| Per-agent compact status for dashboards | `GET /health/agents` |
| Compliance/SLA summary | `GET /health/compliance` |
| Idle-nudge suppression/debug reasons | `GET /health/idle-nudge/debug` |
| OpenClaw gateway connection + fix | `GET /openclaw/status` |

---

## `/health` (service-level heartbeat)

Use when:
- checking process liveness
- confirming core counters are returning

Typical fields:
- `status`
- `tasks` summary
- `chat` summary
- `inbox` summary
- `timestamp`

```bash
curl -s http://127.0.0.1:4445/health
```

---

## `/health/team` (rich team health context)

Use when:
- triaging blockers/overlap trends
- reviewing lane-level coordination context
- comparing multiple health dimensions in one payload

Typical sections include:
- agents list with state metadata
- blockers and overlap summaries
- compliance-related context

```bash
curl -s http://127.0.0.1:4445/health/team
```

---

## `/health/agents` (compact per-agent projection)

Use when:
- powering dashboards/widgets
- quickly scanning active vs stale agents
- scripting per-agent checks

Expected per-agent fields:
- `last_seen`
- `active_task`
- `heartbeat_age_ms`
- `state`
- optional stale diagnostics (for example: `stale_reason`)

```bash
curl -s http://127.0.0.1:4445/health/agents
```

---

## `/health/compliance` (SLA enforcement view)

Use when:
- checking cadence/working-time compliance status
- validating whether a watcher alert is policy-backed

```bash
curl -s http://127.0.0.1:4445/health/compliance
```

---

## Debug endpoints (watchdog behavior)

### State inspection

```bash
curl -s http://127.0.0.1:4445/health/idle-nudge/debug
```

### Dry-run ticks (no side effects)

```bash
curl -s -X POST 'http://127.0.0.1:4445/health/idle-nudge/tick?dryRun=true'
curl -s -X POST 'http://127.0.0.1:4445/health/cadence-watchdog/tick?dryRun=true'
curl -s -X POST 'http://127.0.0.1:4445/health/mention-rescue/tick?dryRun=true'
```

Use these before concluding a signal is a true breach vs suppressed/cooldown case.

---

## `/openclaw/status` (gateway connection check)

Use when:
- diagnosing "openclaw: not configured" in `/health`
- verifying gateway token and URL are set
- getting step-by-step remediation for fresh installs

Response when **not configured**:
```json
{
  "connected": false,
  "status": "not configured",
  "fix": "Set OPENCLAW_GATEWAY_TOKEN in .env ...",
  "docs": "https://docs.openclaw.ai/gateway"
}
```

Response when **configured**:
```json
{
  "connected": true,
  "status": "configured",
  "gateway": "ws://127.0.0.1:18789",
  "agentId": "reflectt-node"
}
```

**How to fix "not configured":**

1. Get your gateway token:
   ```bash
   cat ~/.openclaw/openclaw.json | grep gateway_token
   # or generate: openclaw gateway token
   ```

2. Set env vars in `.env` or `docker-compose.yml`:
   ```
   OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
   OPENCLAW_GATEWAY_TOKEN=<your-token>
   ```

3. Restart reflectt-node.

See also: [Bootstrap first 5 minutes](./bootstrap-first-5-minutes.md)

---

## Common interpretation mistakes

1. Treating `/health/agents` as full incident context (it is intentionally compact).
2. Treating `/health/team` overlap hints as final truth without checking lane comments/scope-split notes.
3. Ignoring debug suppression reasons before escalating idle-nudge alerts.

---

## Minimal operator routine

1. `GET /health`
2. `GET /health/system`
3. `GET /health/agents`
4. If noisy/conflicting: `GET /health/team` + `/health/idle-nudge/debug`
