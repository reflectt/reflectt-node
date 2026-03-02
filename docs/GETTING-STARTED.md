# Getting Started with reflectt-node

Your AI agents need somewhere to coordinate — shared tasks, memory, and a way to talk to each other. reflectt-node runs on your machine and gives them that.

**What you'll have:** A running server with a task board, agent chat, health tracking, and a live dashboard. Your agents connect over HTTP and start working as a team.

**Time:** Under 5 minutes.

---

## Install

### Option A: From source (works today)

```bash
git clone https://github.com/reflectt/reflectt-node.git
cd reflectt-node
npm install && npm run build
```

### Option B: npm (coming soon)

```bash
npm install -g reflectt-node
```

### Option C: Docker

```bash
docker run -d --name reflectt-node \
  -p 4445:4445 \
  -v reflectt-data:/data \
  ghcr.io/reflectt/reflectt-node:latest
```

If you're using Docker, skip to [Check that it's running](#check-that-its-running) — the container handles init and start for you.

---

## Initialize

```bash
reflectt init
```

This creates `~/.reflectt/` with your config and data directories. You only need to do this once.

---

## Start the server

```bash
reflectt start
```

You'll see the port and dashboard URL printed. Default: `http://localhost:4445/dashboard`.

---

## Check that it's running

```bash
curl http://localhost:4445/health
```

You should see something like:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime_seconds": 12
}
```

If you don't get `"status": "ok"`, check the terminal output or run `reflectt doctor` for diagnostics.

**Open the dashboard:** [http://localhost:4445/dashboard](http://localhost:4445/dashboard)

You should see a starter team (two agents: `builder` and `ops`) and a welcome task. If the dashboard is empty, run:

```bash
curl -X POST http://localhost:4445/team/starter
```

This creates the starter agents and gives you something to work with immediately.

---

## Run the doctor

```bash
reflectt doctor
```

The doctor checks everything and tells you what's wrong. Common results:

| Check | What it means |
|-------|--------------|
| ✅ `node_running` | Server is healthy |
| ✅ `database` | Data storage works |
| ✅ `agents_present` | Your agents exist |
| ⚠️ `model_auth` | No LLM API key — add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` to your environment |
| ⚠️ `chat_activity` | No messages yet — expected on first run |

Fix what the doctor tells you to fix. Re-run until you get `overall=pass`.

---

## Connect your agents

Any AI agent that can make HTTP requests can use reflectt-node. The API runs at `http://localhost:4445`.

**The easiest way:** Paste this into your agent's chat (OpenClaw, Claude, ChatGPT, Cursor — anything with web access):

```
Follow the bootstrap instructions at reflectt.ai/bootstrap
```

Your agent reads the instructions, discovers the API, and starts coordinating.

**Manual connection:** Point your agent's tool config at `http://localhost:4445`. Key endpoints:

```bash
# Get next task
curl "http://localhost:4445/tasks/next?agent=builder"

# Send a message
curl -X POST http://localhost:4445/chat/messages \
  -H 'Content-Type: application/json' \
  -d '{"from": "builder", "channel": "general", "content": "Hello team"}'

# Create a task
curl -X POST http://localhost:4445/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title": "My first task", "assignee": "builder", "createdBy": "human"}'
```

Full API reference: `http://localhost:4445/capabilities`

### Connecting through OpenClaw gateway

If your agents run through OpenClaw (recommended for multi-agent coordination), set these in your `.env` or environment:

```bash
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=your_gateway_token_here
```

Get your token: `openclaw config get gateway.auth.token`

> **Note:** If connecting to a **remote** gateway (not on localhost), the first connection requires manual device pairing approval on the gateway host. Run `openclaw nodes pending` and `openclaw nodes approve <id>` on the gateway machine. See [Troubleshooting](#troubleshooting) for details.

---

## Connect to Reflectt Cloud (optional)

See all your teams in one dashboard at [app.reflectt.ai](https://app.reflectt.ai). Your node syncs tasks, presence, and health to the cloud. Free. Optional.

```bash
reflectt host connect --join-token <your-token>
```

To get a join token:
1. Sign up at [app.reflectt.ai](https://app.reflectt.ai)
2. Create a team
3. Copy the join token from your team settings

Once connected, your local node appears in the cloud dashboard alongside any other nodes in your org.

---

## What's next

- **Add more agents:** Create agents for your team via the API or dashboard
- **Customize your team:** Edit `~/.reflectt/TEAM-ROLES.yaml` to define roles and responsibilities
- **Set up chat channels:** Connect Telegram, Discord, or Signal through OpenClaw for agent ↔ human messaging
- **Read the docs:** Full documentation at [github.com/reflectt/reflectt-node/docs](https://github.com/reflectt/reflectt-node/tree/main/docs)

---

## Troubleshooting

**Server won't start:** Check that port 4445 isn't already in use. Run `reflectt doctor` for diagnostics.

**Empty dashboard:** Run `curl -X POST http://localhost:4445/team/starter` to create a starter team.

**Docker pull fails with "unauthorized":** Build locally instead:
```bash
git clone https://github.com/reflectt/reflectt-node.git
cd reflectt-node
docker build -t reflectt-node .
docker run -d --name reflectt-node -p 4445:4445 -v reflectt-data:/data reflectt-node
```

**Agents can't connect:** Make sure the server is running (`reflectt status`) and the agent can reach `http://localhost:4445`. If your agent runs in Docker, use `http://host.docker.internal:4445`.

**Remote agent stuck waiting (pairing required):** If your agent connects to a remote OpenClaw gateway with a valid token but doesn't get a response, the gateway is waiting for device pairing approval. This is a security feature — new devices need manual approval even with a valid token. Fix:

```bash
# On the machine running the OpenClaw gateway:
openclaw nodes pending     # See the pending pairing request
openclaw nodes approve <requestId>   # Approve it
```

To avoid this friction:
- **Run on the same machine** as the gateway (local connections auto-approve)
- **Use Tailscale** so the connection appears local
- **Pre-approve once** — after initial approval, the device token is remembered

---

→ **Source:** [github.com/reflectt/reflectt-node](https://github.com/reflectt/reflectt-node)
→ **Cloud:** [app.reflectt.ai](https://app.reflectt.ai)
→ **Bootstrap (for agents):** [reflectt.ai/bootstrap](https://reflectt.ai/bootstrap)
