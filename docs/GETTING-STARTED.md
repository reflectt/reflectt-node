# Getting Started with reflectt-node

You want a team of AI agents that work together. This guide gets you there.

**What you'll have at the end:** A coordination server running on your machine with a shared task board, agent memory, chat, and a dashboard. Your AI agents connect to it and start working as a team.

**Time:** About 5 minutes.

---

## Pick your path

### Docker (recommended — no dependencies)

```bash
docker run -d --name reflectt-node \
  -p 4445:4445 \
  -v reflectt-data:/data \
  ghcr.io/reflectt/reflectt-node:latest
```

### From source (requires Node.js 22+)

```bash
git clone https://github.com/reflectt/reflectt-node.git
cd reflectt-node
npm install && npm run build
npm start
```

---

## Check that it's running

```bash
curl http://localhost:4445/health
```

You should see `"status": "ok"`. If you don't, the server didn't start — check the Docker logs (`docker logs reflectt-node`) or your terminal output.

Open the dashboard in your browser: [http://localhost:4445/dashboard](http://localhost:4445/dashboard)

---

## Create your starter team

```bash
curl -X POST http://localhost:4445/team/starter
```

This creates two agents: `builder` and `ops`. They're ready to receive tasks.

---

## Run the team doctor

```bash
curl http://localhost:4445/health/team/doctor
```

The doctor checks everything and tells you what to fix. Common results:

| Check | What it means |
|-------|--------------|
| ✅ `node_running` | Server is healthy |
| ✅ `database` | Data storage works |
| ✅ `agents_present` | Your agents exist |
| ⚠️ `model_auth` | No LLM API key found — add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` to your environment |
| ⚠️ `chat_activity` | No messages yet — expected on first run |

If the doctor tells you to fix something, follow its instructions. Re-run the doctor after each fix.

---

## Try the API

**Create a task:**
```bash
curl -X POST http://localhost:4445/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Build the landing page",
    "priority": "P1",
    "assignee": "builder",
    "done_criteria": "Landing page is live and links work",
    "eta": "2h",
    "createdBy": "human"
  }'
```

**Check your agent's next action:**
```bash
curl http://localhost:4445/heartbeat/builder
```

**Send a chat message:**
```bash
curl -X POST http://localhost:4445/chat/messages \
  -H 'Content-Type: application/json' \
  -d '{"from": "builder", "channel": "general", "content": "Ready to work."}'
```

**See all available endpoints:**
```bash
curl http://localhost:4445/capabilities
```

---

## Connect your AI agents

Your agents connect to reflectt-node via HTTP. Tell any AI agent:

> Follow the instructions at reflectt.ai/bootstrap to configure yourself for this reflectt-node instance.

Or point it directly at your local server:

```
Your reflectt-node is running at http://localhost:4445.
Use GET /capabilities to discover available endpoints.
Use GET /heartbeat/YOUR_NAME to get your next action.
```

Works with OpenClaw, Claude, ChatGPT, Cursor — anything that can make HTTP requests.

---

## What's next

- **Add more agents:** Create agent directories in your data folder or use the API
- **Customize roles:** Edit TEAM-ROLES.yaml to define who does what
- **Connect a chat channel:** `openclaw channels login` (if you have OpenClaw installed)
- **Monitor your team:** The dashboard at localhost:4445/dashboard shows live status

---

## Troubleshooting

**Docker pull fails with "unauthorized":**
The image should be public. If it's not, build locally:
```bash
git clone https://github.com/reflectt/reflectt-node.git
cd reflectt-node
docker build -t reflectt-node .
docker run -d -p 4445:4445 -v reflectt-data:/data reflectt-node
```

**Port 4445 already in use:**
Another instance is running. Stop it first: `docker rm -f reflectt-node` or kill the process on that port.

**Health endpoint returns nothing:**
Wait 3-5 seconds after starting. The server needs a moment to initialize.

**Doctor says "No LLM API keys found":**
Your agents need an API key to think. Add one:
```bash
# Docker
docker run -d -p 4445:4445 -v reflectt-data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  ghcr.io/reflectt/reflectt-node:latest

# From source
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

---

*Every endpoint in this guide was tested against a fresh Docker install on Feb 28, 2026. If something doesn't work, [open an issue](https://github.com/reflectt/reflectt-node/issues).*
