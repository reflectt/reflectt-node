# Quick Start Guide

Get reflectt-node running in 5 minutes.

## Prerequisites

- Node.js 18+ (20+ recommended)
- OpenClaw installed and running
- Git

## Step 1: Clone

```bash
git clone https://github.com/reflectt/reflectt-node.git
cd reflectt-node
```

## Step 2: Install

```bash
npm install
```

## Step 3: Configure OpenClaw

### Get your gateway token

```bash
# Check if OpenClaw is running
openclaw status

# Get or set your gateway token
openclaw config get gateway.auth.token

# If not set, create one:
openclaw config set gateway.auth.token "$(openssl rand -hex 32)"
```

### Create `.env` file

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=4445
HOST=127.0.0.1

# Copy the token from above:
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=your_token_here
```

## Step 4: Run

```bash
npm run dev
```

You should see:

```
🚀 Starting reflectt-node...
[OpenClaw] Connecting to ws://127.0.0.1:18789...
[OpenClaw] WebSocket connected, performing handshake...
[OpenClaw] Handshake successful
✅ Server running at http://127.0.0.1:4445
   - REST API: http://127.0.0.1:4445
   - WebSocket: ws://127.0.0.1:4445/chat/ws
   - Health: http://127.0.0.1:4445/health
```

## Step 5: Test It

### Health check

```bash
curl http://127.0.0.1:4445/health
```

Expected output:

```json
{
  "status": "ok",
  "openclaw": "connected",
  "chat": {
    "totalMessages": 0,
    "rooms": 1,
    "subscribers": 0
  },
  "tasks": {
    "total": 0,
    "byStatus": {
      "todo": 0,
      "in-progress": 0,
      "done": 0,
      "blocked": 0
    }
  },
  "timestamp": 1707584400000
}
```

### Send a test message

```bash
curl -X POST http://127.0.0.1:4445/chat/messages \
  -H "Content-Type: application/json" \
  -d '{
    "from": "test-agent",
    "content": "Hello from reflectt-node!"
  }'
```

Expected output:

```json
{
  "success": true,
  "message": {
    "id": "msg-1707584400000-abc123",
    "from": "test-agent",
    "content": "Hello from reflectt-node!",
    "timestamp": 1707584400000
  }
}
```

### Get messages

```bash
curl http://127.0.0.1:4445/chat/messages
```

### Create a task

```bash
curl -X POST http://127.0.0.1:4445/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test reflectt-node",
    "description": "Make sure everything works",
    "createdBy": "test-agent",
    "status": "in-progress"
  }'
```

### Configure designer routing (optional)

If your team has a dedicated designer, you can keep infra/onboarding plumbing work from being auto-routed to them.

1) Copy the default roles file to your host config:

```bash
mkdir -p ~/.reflectt
cp defaults/TEAM-ROLES.yaml ~/.reflectt/TEAM-ROLES.yaml
```

2) Edit `~/.reflectt/TEAM-ROLES.yaml`:
- set your designer agent’s `role: designer`
- optionally set `routingMode: opt-in` + `alwaysRoute` / `neverRoute` + `neverRouteUnlessLane: design`

3) When creating tasks, set routing metadata to make intent explicit:

- `metadata.lane`: `design | product | infra | ops | growth`
- `metadata.surface`: `reflectt-node | reflectt-cloud-app | reflectt.ai | infra`

Example payload that opts in to design review:

```bash
curl -X POST http://127.0.0.1:4445/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Dashboard polish: focus-visible + spacing",
    "createdBy": "sage",
    "assignee": "pixel",
    "reviewer": "echo",
    "eta": "45m",
    "done_criteria": ["Before/after screenshots in process/"],
    "priority": "P2",
    "metadata": {
      "lane": "design",
      "surface": "reflectt-node",
      "tags": ["ui", "a11y"]
    }
  }'
```

More details: see `docs/LANE_SURFACE_ROUTING.md`.

## Step 6: WebSocket (Real-time Chat)

Using `wscat` (install with `npm i -g wscat`):

```bash
wscat -c ws://127.0.0.1:4445/chat/ws
```

You'll receive message history and any new messages in real-time.

## Troubleshooting

### "Not connected to OpenClaw gateway"

- Make sure OpenClaw is running: `openclaw gateway status`
- Start it if needed: `openclaw gateway start`
- Check the gateway URL and token in `.env`

### "Connection refused"

- Check if port 4445 is available: `lsof -i :4445`
- Change `PORT` in `.env` if needed

### "Request timeout"

- OpenClaw gateway might not be responding
- Check logs: `openclaw logs`
- Restart gateway: `openclaw gateway restart`

## Next Steps

- **Integrate with agents:** Use the REST API from your agent tools
- **Connect UI:** Point chat.reflectt.ai to this node
- **Add tools:** Import Homie tools or create custom ones
- **Read the docs:** See `README.md` and `ARCHITECTURE.md`

---

**You're ready to start building!**
