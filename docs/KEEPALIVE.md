# Keepalive: Preventing Idle Freeze

Serverless platforms (Cloudflare Workers, AWS Lambda, etc.) recycle containers after idle periods. When a reflectt-node instance goes cold, it loses in-memory state and takes time to restart. This guide covers how to keep your instance warm.

## The Problem

After ~5-15 minutes of inactivity:
- Cloudflare Workers containers are evicted
- Cold starts can take 2-10 seconds
- In-memory state (chat history, event bus) is lost
- SSE/WebSocket connections drop

## Solution: Keepalive Ping

reflectt-node exposes a lightweight endpoint designed for keepalive:

```
GET /health/ping
```

Response:
```json
{ "status": "ok", "uptime_seconds": 3600, "ts": 1772238000000 }
```

No database queries, no computation — instant response. Safe to call every 30-60 seconds.

## Setup Options

### Option 1: Cloudflare Cron Trigger (Recommended for Workers)

Add a cron trigger to your `wrangler.toml`:

```toml
[triggers]
crons = ["*/1 * * * *"]  # Every minute
```

Then handle the scheduled event in your worker:

```typescript
export default {
  async fetch(request, env) {
    // ... your existing fetch handler
  },

  async scheduled(event, env, ctx) {
    // Keepalive: hit the health endpoint to prevent idle eviction
    const url = `${env.REFLECTT_URL || 'http://localhost:4445'}/health/ping`
    ctx.waitUntil(fetch(url).catch(() => {}))
  },
}
```

### Option 2: External Cron (Any Platform)

Use any cron service to ping your instance:

```bash
# crontab -e
* * * * * curl -s https://your-instance.example.com/health/ping > /dev/null
```

Or use a monitoring service:
- **UptimeRobot** — Free tier, 5-minute intervals
- **Cronitor** — Monitors + alerts
- **Better Uptime** — 3-minute intervals on free tier
- **GitHub Actions** — schedule workflow with `cron: '*/5 * * * *'`

### Option 3: Docker / systemd (Self-Hosted)

Self-hosted instances don't need keepalive — the process stays running. But you may want health monitoring:

```bash
# systemd watchdog (add to your .service file)
[Service]
WatchdogSec=60
ExecStartPost=/bin/sh -c 'while true; do curl -sf http://localhost:4445/health/ping || exit 1; sleep 30; done &'
```

## Monitoring Cold Starts

The `/health` endpoint includes a `cold_start` flag:

```json
{ "status": "ok", "cold_start": true, "uptime_seconds": 12 }
```

`cold_start` is `true` when uptime is under 60 seconds. Use this to:
- Track cold start frequency in your monitoring dashboard
- Alert on excessive restarts
- Measure warm-up time

## Host Registry Status

If your instance reports to a host registry (`/hosts`), the status thresholds are:
- **online**: last seen < 5 minutes ago
- **stale**: last seen 5-15 minutes ago
- **offline**: last seen > 15 minutes ago

A keepalive ping every 1-2 minutes keeps the host status as "online".

## Self-Keepalive (Built-in)

reflectt-node includes a built-in self-keepalive that pings itself to prevent container eviction. Enable it with:

```bash
REFLECTT_KEEPALIVE=true
```

It auto-enables when Cloudflare environment variables are detected (`CF_PAGES`, `CF_WORKER`, etc.).

**How it works:**
- Pings `localhost:PORT/health/ping` every 4 minutes
- Detects warm boots (recovering from restart with existing DB data)
- Reports cold start count and last activity age

**Status endpoint:**
```
GET /health/keepalive
```

Returns:
```json
{
  "enabled": true,
  "intervalMs": 240000,
  "lastPingAt": 1772260000000,
  "lastPingOk": true,
  "coldStarts": 0,
  "bootInfo": {
    "isColdStart": false,
    "isWarmBoot": true,
    "lastActivityAge": 5000,
    "recoveredState": { "tasks": 42, "chatMessages": 1200, "hosts": 2, "reflections": 15 }
  }
}
```

## Cloudflare Deployment Caveats

- **SQLite persists** across warm restarts (same container) but is **lost on cold starts** in Workers (no filesystem). Use Cloudflare Containers or Docker with a volume mount for persistent state.
- **SSE/WebSocket connections drop** on container eviction — clients reconnect automatically with exponential backoff (1s→30s).
- **Self-keepalive + external cron** together provide the best coverage: self-keepalive prevents idle eviction, external cron detects if the instance died entirely.
- In Docker/Containers: mount `REFLECTT_HOME` to a persistent volume (`-v reflectt-data:/data -e REFLECTT_HOME=/data`).

## Troubleshooting

**Worker still goes cold despite cron trigger:**
- Cloudflare may evict containers even with cron if there's resource pressure
- Ensure the cron handler actually makes a fetch to the worker URL (not just runs)
- Check Workers Analytics for invocation gaps

**High cold start latency:**
- reflectt-node's `/health/ping` is zero-cost (no DB init)
- If full `/health` is slow on cold start, the DB initialization is the bottleneck
- Consider using Durable Objects for persistent state instead of SQLite

**SSE connections drop on cold start:**
- Expected behavior — clients should reconnect with exponential backoff
- reflectt-node's SSE client (`src/openclaw.ts`) handles this automatically (1s → 30s cap)
