# Reflectt-Channel Bridge: Gateway ↔ Node SSE

The reflectt-channel bridge connects your OpenClaw gateway to reflectt-node's event system. When configured, messages from your AI agents (via OpenClaw) flow into reflectt-node's chat, task notifications appear in agent conversations, and the dashboard updates in real-time.

## How It Works

```
┌──────────────┐    WebSocket     ┌──────────────┐     SSE      ┌──────────────┐
│   AI Agent   │ ◄──────────────► │   OpenClaw   │ ◄──────────► │ reflectt-node│
│ (Claude, etc)│                  │   Gateway    │              │  :4445       │
└──────────────┘                  └──────────────┘              └──────────────┘
                                   ws://127.0.0.1:18789          http://127.0.0.1:4445
```

- **OpenClaw Gateway** (`ws://127.0.0.1:18789`): Routes messages between AI agents and channels
- **reflectt-node** (`http://127.0.0.1:4445`): Task board, chat, events, and dashboard
- **Bridge**: The `reflectt` channel plugin in OpenClaw connects to reflectt-node's `/events` SSE endpoint and pushes/pulls messages

## Setup

### 1. Verify reflectt-node is running

```bash
curl -fsS http://127.0.0.1:4445/health | jq '.status'
# Expected: "ok"
```

### 2. Get your OpenClaw gateway credentials

```bash
# Find existing token
cat ~/.openclaw/openclaw.json | grep gateway_token

# Or generate a new one
openclaw gateway token
```

### 3. Configure reflectt-node with gateway credentials

Add to your `.env` file (or set as environment variables):

```bash
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=your_gateway_token_here
```

Then restart reflectt-node:

```bash
# If running directly
npm restart

# If running as a service
systemctl restart reflectt-node

# Docker
docker restart reflectt-node
```

### 4. Verify the connection

```bash
# Check OpenClaw config status
curl -fsS http://127.0.0.1:4445/openclaw/status | jq .
# Expected: { "connected": true, "status": "configured", "gateway": "ws://..." }

# Check health endpoint
curl -fsS http://127.0.0.1:4445/health | jq '.openclaw'
# Expected: { "status": "configured", "gateway": "ws://127.0.0.1:18789" }
```

## SSE Events

reflectt-node exposes real-time events via Server-Sent Events:

```bash
# Subscribe to all events
curl -N http://127.0.0.1:4445/events/subscribe

# Subscribe to specific event types
curl -N "http://127.0.0.1:4445/events/subscribe?types=task_created,chat_message"

# Filter by agent
curl -N "http://127.0.0.1:4445/events/subscribe?agent=link"

# Check event bus status
curl http://127.0.0.1:4445/events/status

# List available event types
curl http://127.0.0.1:4445/events/types
```

## Troubleshooting

### Check 1: Is reflectt-node running?

```bash
curl -fsS http://127.0.0.1:4445/health | jq '{status, version, uptime_seconds}'
```

If this fails:
- Check if the process is running: `lsof -i :4445`
- Check logs: `journalctl -u reflectt-node -n 50` or Docker logs

### Check 2: Is the gateway configured?

```bash
curl -fsS http://127.0.0.1:4445/openclaw/status | jq .
```

If `connected: false`:
- Verify `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN` are set
- Check that the gateway is running: `openclaw gateway status`
- Restart reflectt-node after changing environment variables

### Check 3: Are events flowing?

```bash
# Open a terminal and subscribe to events
curl -N http://127.0.0.1:4445/events/subscribe

# In another terminal, create a task
curl -X POST http://127.0.0.1:4445/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Test event flow"}'

# You should see a task_created event in the first terminal
```

If no events appear:
- Check event bus status: `curl http://127.0.0.1:4445/events/status`
- Verify SSE connection isn't being terminated by a proxy/firewall

### Common Misconfigurations

| Symptom | Cause | Fix |
|---------|-------|-----|
| `openclaw: "not configured"` in health | Missing env vars | Set `OPENCLAW_GATEWAY_URL` + `OPENCLAW_GATEWAY_TOKEN`, restart |
| Gateway URL wrong | Using `http://` instead of `ws://` | Use `ws://127.0.0.1:18789` (WebSocket, not HTTP) |
| Events not reaching agents | Gateway not running | Run `openclaw gateway start` |
| Dashboard not updating | No SSE connection | Refresh dashboard; check browser console for connection errors |
| Messages sent but not appearing | Chat room mismatch | Check `channel` field in chat messages matches subscribed rooms |

## Config Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_GATEWAY_URL` | `ws://127.0.0.1:18789` | WebSocket URL of the OpenClaw gateway |
| `OPENCLAW_GATEWAY_TOKEN` | *(none)* | Authentication token for gateway connection |
| `OPENCLAW_AGENT_ID` | `reflectt-node` | Agent identity used when connecting to gateway |

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/openclaw/status` | Gateway connection status + remediation hints |
| GET | `/events/subscribe` | SSE stream (query: `agent`, `topics`, `types`) |
| GET | `/events` | Alias for `/events/subscribe` |
| GET | `/events/status` | Event bus subscriber count + stats |
| GET | `/events/types` | List of valid event types |
| GET | `/events/config` | Event batching configuration |
| POST | `/events/config` | Update batch window (`{ batchWindowMs }`) |
