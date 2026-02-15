# reflectt-node

Local coordination server for AI agent teams. Provides real-time chat, task management, health monitoring, and a live dashboard — all running on your machine.

Built for [OpenClaw](https://github.com/openclaw/openclaw) agent workflows.

## 5-Minute Quickstart

### Prerequisites

- **Node.js** 22+ (`node -v`)
- **npm** 9+ (`npm -v`)
- **Git** (`git --version`)

### 1. Clone and install

```bash
git clone https://github.com/reflectt/reflectt-node.git
cd reflectt-node
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
PORT=4445
HOST=127.0.0.1
NODE_ENV=development
```

**Optional — OpenClaw gateway connection:**

If you're running OpenClaw agents that need to communicate through reflectt-node:

```env
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=your_gateway_token_here
```

Find your gateway token in `~/.openclaw/openclaw.json` or set one:

```bash
openclaw config set gateway.auth.token "your-token-here"
```

### 3. Build and run

```bash
npm run build
npm start
```

Or for development with hot reload:

```bash
npm run dev
```

### 4. Verify it works

```bash
curl http://127.0.0.1:4445/health
```

You should see:

```json
{
  "status": "ok",
  "chat": { "totalMessages": 0, "rooms": 1 },
  "tasks": { "total": 0 }
}
```

Open the dashboard in your browser:

```
http://127.0.0.1:4445/dashboard
```

You should see the live dashboard with task board, team health, chat, and activity panels.

**That's it. You're running.**

---

## What reflectt-node Does

| Feature | Description |
|---------|-------------|
| **Agent Chat** | Real-time messaging between agents via REST + WebSocket |
| **Task Board** | Full CRUD task management with status, priority, assignees |
| **Live Dashboard** | Browser-based dashboard with task board, health, compliance, chat |
| **Team Health** | Agent presence tracking, blocker detection, overlap warnings |
| **Collaboration Compliance** | Cadence monitoring, status freshness, escalation tracking |
| **Inbox System** | Per-agent message queues for async coordination |
| **OpenClaw Integration** | Connects to your local OpenClaw gateway for agent orchestration |

## API Reference

### Health

```bash
# Server health + stats
curl http://127.0.0.1:4445/health
```

### Tasks

```bash
# List all tasks
curl http://127.0.0.1:4445/tasks

# List tasks with filters
curl "http://127.0.0.1:4445/tasks?status=doing&assignee=link"

# Get a single task
curl http://127.0.0.1:4445/tasks/<task-id>

# Create a task
curl -X POST http://127.0.0.1:4445/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Ship the feature",
    "status": "todo",
    "assignee": "link",
    "reviewer": "pixel",
    "priority": "P1",
    "tags": ["reflectt-node"]
  }'

# Update a task
curl -X PATCH http://127.0.0.1:4445/tasks/<task-id> \
  -H 'Content-Type: application/json' \
  -d '{"status": "done"}'

# Get next task for an agent
curl "http://127.0.0.1:4445/tasks/next?agent=link"
```

### Chat

```bash
# Get recent messages
curl "http://127.0.0.1:4445/chat/messages?limit=50"

# Send a message
curl -X POST http://127.0.0.1:4445/chat/messages \
  -H 'Content-Type: application/json' \
  -d '{
    "from": "link",
    "content": "Task complete!",
    "channel": "general"
  }'

# List channels
curl http://127.0.0.1:4445/chat/rooms
```

**WebSocket (real-time):**

```
ws://127.0.0.1:4445/chat/ws
```

### Inbox

```bash
# Check agent inbox
curl http://127.0.0.1:4445/inbox/link

# Send to agent inbox
curl -X POST http://127.0.0.1:4445/inbox/link \
  -H 'Content-Type: application/json' \
  -d '{"from": "kai", "content": "Please review the PR"}'
```

### Dashboard

```
# Open in browser
http://127.0.0.1:4445/dashboard
```

The dashboard auto-refreshes and shows:
- Task board with drag-and-drop columns
- Agent presence and health status
- Collaboration compliance metrics
- Real-time chat with task-ID deep linking
- Promotion SSOT panel (when configured)

## Running as a Service (macOS)

To run reflectt-node as a persistent background service:

```bash
# Create a launchd plist (adjust paths to your setup)
cat > ~/Library/LaunchAgents/com.reflectt.node.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.reflectt.node</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/path/to/reflectt-node</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
EOF

# Load the service
launchctl load ~/Library/LaunchAgents/com.reflectt.node.plist

# Restart the service
launchctl kickstart -k gui/$(id -u)/com.reflectt.node
```

## Deploy Coordination (Code ↔ Server Sync)

When the repo changes but the running process has not been restarted, dashboard/API behavior can drift from source code.

Use these endpoints to make deploy state explicit:

```bash
# Compare startup snapshot vs current repo state
curl -s http://127.0.0.1:4445/release/status

# Generate release notes from completed tasks (since last deploy marker by default)
curl -s http://127.0.0.1:4445/release/notes

# Mark a deploy event after restart/verification
curl -s -X POST http://127.0.0.1:4445/release/deploy \
  -H 'Content-Type: application/json' \
  -d '{"deployedBy":"ryan","note":"restart after task-comments ship"}'
```

Dashboard header shows a deploy badge (`in sync` vs `stale`) backed by `/release/status`.

## Running Tests

```bash
# Build first
npm run build

# Task-linkify regression suite
npm run test:task-linkify:regression

# SSOT indicator state tests
npm run test:ssot-indicator:regression

# Dry-run transcript validator
npm run test:task-linkify:dryrun-validator -- <transcript-path>

# Negative-fixture validator tests
npm run test:task-linkify:dryrun-negative-fixtures
```

## Project Structure

```
src/
  index.ts        # Entry point
  server.ts       # Fastify server + route registration
  chat.ts         # Chat message manager + WebSocket
  tasks.ts        # Task CRUD + lifecycle gates
  dashboard.ts    # Live dashboard (HTML/CSS/JS served inline)
  health.ts       # Team health + presence aggregation
  inbox.ts        # Per-agent async inbox
  presence.ts     # Agent presence tracking
  config.ts       # Configuration loader
  openclaw.ts     # OpenClaw gateway client
  analytics.ts    # Usage analytics
  types.ts        # TypeScript type definitions

tools/                          # Test harnesses and operational scripts
docs/                           # Promotion runbooks and operational docs
artifacts/                      # CI/test artifacts and evidence
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `4445` | Server port |
| `HOST` | No | `127.0.0.1` | Bind address |
| `NODE_ENV` | No | `development` | Environment |
| `OPENCLAW_GATEWAY_URL` | No | — | WebSocket URL for OpenClaw gateway |
| `OPENCLAW_GATEWAY_TOKEN` | No | — | Auth token for gateway connection |
| `IDLE_NUDGE_ENABLED` | No | `false` | Enable idle agent nudge system |

## Troubleshooting

### Server won't start

```bash
# Check if port is already in use
lsof -i :4445  # or: /usr/sbin/lsof -i :4445

# Kill existing process if needed
kill $(lsof -t -i :4445)

# Rebuild and try again
npm run build
npm start
```

### Health check returns error

```bash
# Verify the server is running
curl -v http://127.0.0.1:4445/health

# Check logs for errors
npm run dev  # dev mode shows full logs
```

### Dashboard is blank or panels missing

```bash
# Force rebuild (clears compiled JS)
rm -rf dist/
npm run build

# Restart service
launchctl kickstart -k gui/$(id -u)/com.reflectt.node
```

### OpenClaw connection fails

```bash
# Verify gateway is running
openclaw status

# Check your token matches
cat ~/.openclaw/openclaw.json | grep token

# Verify .env has correct URL and token
cat .env
```

### Build fails

```bash
# Clear and reinstall
rm -rf node_modules dist
npm install
npm run build
```

## License

Apache-2.0

---

**Built by [Team Reflectt](https://reflectt.ai)**
