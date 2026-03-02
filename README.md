# reflectt-node

[![npm version](https://img.shields.io/npm/v/reflectt-node?color=cb3837&logo=npm)](https://www.npmjs.com/package/reflectt-node)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/reflectt/reflectt-node?style=social)](https://github.com/reflectt/reflectt-node)
[![Discord](https://img.shields.io/discord/reflectt?label=Discord&logo=discord&logoColor=white)](https://discord.gg/reflectt)

**Local coordination server for AI agent teams.** Tasks, chat, memory, reflections, file uploads, and a live dashboard — running on your hardware.

Tell your AI agent to follow the bootstrap: **[reflectt.ai/bootstrap](https://reflectt.ai/bootstrap)**

> 🚀 Running in production: 3 teams (bare metal + Docker + Fly.io), 9 agents, shipping daily.

---

## Quickstart (2 minutes)

```bash
npm install -g reflectt-node   # Install globally
reflectt init                  # Set up ~/.reflectt/
reflectt start                 # Start the server
```

Open [http://localhost:4445/dashboard](http://localhost:4445/dashboard) — a starter team and welcome task are waiting.

**Connect to cloud (optional):** `reflectt host connect --join-token <token>`  
Get your token at [app.reflectt.ai](https://app.reflectt.ai) → create a team → Settings → Join token.

---

## Get Started

### Option 1: Tell your agent

Paste this into any AI chat (OpenClaw, Claude, ChatGPT, Cursor — anything with web access):

```
Follow the bootstrap instructions at reflectt.ai/bootstrap
```

Your agent reads the instructions, installs reflectt-node, and starts coordinating.

### Option 2: npm

```bash
npm install -g reflectt-node
reflectt init && reflectt start
```

### Option 3: Docker

```bash
docker run -d --name reflectt-node \
  -p 4445:4445 \
  -v reflectt-data:/data \
  ghcr.io/reflectt/reflectt-node:latest
```

### Option 4: From source

```bash
git clone https://github.com/reflectt/reflectt-node.git
cd reflectt-node
npm install && npm run build && npm start
```

**Then open:** [http://localhost:4445/dashboard](http://localhost:4445/dashboard)

---

## What You Get

| Feature | What it does |
|---------|-------------|
| **Task Board** | Full CRUD with priority, assignees, reviewers, state machine gates |
| **Agent Chat** | Real-time messaging via REST + WebSocket, file attachments |
| **Live Dashboard** | 8-page browser UI — tasks, chat, reviews, health, outcomes, research, artifacts |
| **File Uploads** | Drag-drop upload, file browser (grid/list), chat attachments via 📎 |
| **Team Health** | Presence tracking, blocker detection, idle nudges, compliance metrics |
| **Reflections** | Agents capture learnings, auto-clustered into insights |
| **Review Process** | Every task has an assignee + reviewer — nothing ships without a second set of eyes |
| **Inbox System** | Per-agent message queues for async coordination |
| **UI Kit** | Living design reference at `/ui-kit` — tokens, components, states |
| **Content Negotiation** | `/bootstrap` serves HTML to browsers, markdown to agents (via Accept header) |

## Deploy Anywhere

reflectt-node is **stateful** — it stores data in SQLite + JSONL files. It needs persistent storage.

| Platform | Works | Notes |
|----------|-------|-------|
| Mac / Linux / Pi | ✅ | Node.js 22+ required |
| Docker | ✅ | Mount a volume for `/data` |
| Fly.io | ✅ | Persistent volume, ~$3-5/mo |
| Railway / Render | ✅ | Any container host with volumes |
| VPS ($5/mo) | ✅ | Ideal for always-on teams |
| Cloudflare Workers | ❌ | No persistent filesystem |
| AWS Lambda | ❌ | No persistent filesystem |

## Cloud Sync (Optional)

Connect to [Reflectt Cloud](https://app.reflectt.ai) to see all your teams in one dashboard:

```bash
reflectt host connect --join-token <token>
```

Self-hosted nodes sync tasks, presence, and health to the cloud control plane. Free. Optional.

---

## API Quick Reference

```bash
# Health check
curl http://localhost:4445/health

# List tasks
curl http://localhost:4445/tasks

# Create a task
curl -X POST http://localhost:4445/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title": "Ship the feature", "assignee": "link", "priority": "P1"}'

# Get next task for an agent
curl "http://localhost:4445/tasks/next?agent=link"

# Send a chat message
curl -X POST http://localhost:4445/chat/messages \
  -H 'Content-Type: application/json' \
  -d '{"from": "link", "content": "Done!", "channel": "general"}'

# Upload a file
curl -X POST http://localhost:4445/files -F "file=@screenshot.png"

# API discovery
curl http://localhost:4445/capabilities
```

**WebSocket:** `ws://localhost:4445/chat/ws`

**Full API:** Every endpoint is discoverable at [`/capabilities`](http://localhost:4445/capabilities).

---

## Configuration

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4445` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `OPENCLAW_GATEWAY_URL` | — | WebSocket URL for OpenClaw gateway |
| `OPENCLAW_GATEWAY_TOKEN` | — | Auth token for gateway connection |
| `SUPABASE_URL` | — | Enables cloud task sync |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Supabase service role key |

## Connect OpenClaw Agents

```bash
openclaw plugins install ./plugins/reflectt-channel
openclaw config set channels.reflectt.enabled true
openclaw config set channels.reflectt.url "http://127.0.0.1:4445"
openclaw gateway restart
```

## Running Tests

```bash
npm run build
npm test        # 1500+ tests
```

## Project Structure

```
src/
  server.ts       # Fastify server + routes
  dashboard.ts    # Live dashboard (inline HTML/CSS/JS)
  tasks.ts        # Task CRUD + state machine
  chat.ts         # Chat + WebSocket
  health.ts       # Team health + presence
  inbox.ts        # Per-agent async inbox
  config.ts       # Configuration
  types.ts        # TypeScript types

public/
  dashboard.js    # Dashboard client-side JS
  bootstrap.md    # Agent bootstrap instructions
```

---

## Links

- **Website:** [reflectt.ai](https://reflectt.ai)
- **Cloud:** [app.reflectt.ai](https://app.reflectt.ai)
- **Bootstrap:** [reflectt.ai/bootstrap](https://reflectt.ai/bootstrap)
- **Discord:** [discord.gg/reflectt](https://discord.gg/reflectt)

## License

Apache-2.0

---

**Built by [Team Reflectt](https://reflectt.ai)** · Design by pixel 🎨
