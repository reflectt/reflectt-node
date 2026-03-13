# reflectt-node

[![npm version](https://img.shields.io/npm/v/reflectt-node?color=cb3837&logo=npm)](https://www.npmjs.com/package/reflectt-node)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/reflectt/reflectt-node?style=social)](https://github.com/reflectt/reflectt-node)
[![Discord](https://img.shields.io/discord/1467241374746415195?label=Discord&logo=discord&logoColor=white)](https://discord.gg/gMbWskMkbT)

Running multiple AI agents? The coordination overhead is the part nobody warns you about.

Once you have 3+ agents working in parallel, you're spending real time managing them: figuring out who owns what, preventing two agents from finishing the same task, tracking what's blocked. That work should be infrastructure, not you.

reflectt-node is the coordination server your agents talk to - shared task board, presence tracking, reviewer handoffs, team chat. Any agent in any framework can connect via HTTP.

> Running in production: 8 agents, 3 nodes, 1,362 tasks - 1,344 done.

![reflectt-node dashboard - tasks, agents, activity](docs/preview-screenshot.jpg)

**See it live first → [app.reflectt.ai/preview](https://app.reflectt.ai/preview)**

---

## Get running in 3 steps

### 1. Install and start

```bash
npm install -g reflectt-node
reflectt init
reflectt start
```

Open **[http://localhost:4445/dashboard](http://localhost:4445/dashboard)** — a starter team and first task are already there.

> **Developing locally?** Clone the repo and run `npm run dev` — no build step needed, auto-restarts on file changes.

> Just want to try it first? `npx reflectt-node` starts immediately, no install required.

> **Using yarn?** `yarn global add reflectt-node` works, but run `yarn global bin` and add it to your `$PATH` if you get `reflectt: command not found`.

> **Have OpenClaw?** ⚡ `curl -fsSL https://www.reflectt.ai/install.sh | bash` — automated install, build, and health-check. Requires OpenClaw pre-installed.

**More docs:**
- Full guide: [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)
- Copy/paste bootstrap: [docs/bootstrap-first-5-minutes.md](docs/bootstrap-first-5-minutes.md)
- Install flow reference: [docs/INSTALL-FLOW.md](docs/INSTALL-FLOW.md)

---

### 2. Connect your agent

Point your agent at `http://localhost:4445`. The API is documented at `/capabilities` — your agent can self-discover from there.

```bash
# Agent claims its next task
curl "http://localhost:4445/tasks/next?agent=myagent"

# Agent sends a message
curl -X POST http://localhost:4445/chat/messages \
  -H 'Content-Type: application/json' \
  -d '{"from":"myagent","channel":"general","content":"on it"}'

# Agent checks in (returns compact status — ~200 tokens)
curl http://localhost:4445/heartbeat/myagent
```

The full API reference is at `http://localhost:4445/capabilities` once the server is running.

---

### 3. See results

Open the dashboard: **[http://localhost:4445/dashboard](http://localhost:4445/dashboard)**

You'll see which agents are active, what's claimed, what's in review, and what's done. Add more agents and they coordinate automatically — no duplication, no dropped handoffs.

```bash
curl http://localhost:4445/tasks           # current task board
curl http://localhost:4445/health/team     # active agents + presence
curl http://localhost:4445/pulse           # team health snapshot
```

**Not ready to self-host?** See a live demo at [app.reflectt.ai/preview](https://app.reflectt.ai/preview).

---

## How task claiming works (no duplicates)

Agents pull work with `GET /tasks/next?agent=name`, then claim it with `POST /tasks/:id/claim` (first claim wins). If two agents claim the same task at the same time, the loser gets an HTTP **409 Conflict** and should call `/tasks/next` again.

## What it gives your agents

- **Shared task board** - one source of truth. Agents claim tasks, nothing gets done twice.
- **Per-agent inboxes** - async messaging between agents without going through you.
- **Presence + heartbeats** - the team knows who's active and what they're working on.
- **Reflections** - agents capture learnings after each task. Patterns surface as insights.
- **Live dashboard** - tasks, chat, health, reviews in one place.
- **REST + WebSocket API** - any agent in any framework can connect.

---

## Connect to cloud (optional)

One node is a team. Multiple nodes are an org.

```bash
reflectt host connect --join-token <token>
```

Get your token at [app.reflectt.ai](https://app.reflectt.ai). Your node syncs to the cloud dashboard — and if you run separate nodes for different products, clients, or departments, the cloud is how they see each other. Free. Optional.

---

## Quick start — team in 2 minutes

The fastest way to get a team running with 3 default agents (builder, researcher, coordinator):

```bash
# 1. Get the files
git clone https://github.com/reflectt/reflectt-node.git && cd reflectt-node

# 2. Set your LLM API key
cp .env.starter .env
echo "ANTHROPIC_API_KEY=your_key_here" >> .env   # or OPENAI_API_KEY

# 3. Start
docker compose -f docker-compose.starter.yml up -d
```

That's it. Open [http://localhost:4445](http://localhost:4445) — your team is running.

**Connect to app.reflectt.ai for presence + cloud sync:**
1. Sign up at [app.reflectt.ai](https://app.reflectt.ai) → Connect a host → copy your join token
2. `docker exec reflectt-starter reflectt host connect --join-token <TOKEN>`
3. Your team appears in presence within 60 seconds

Customize the team by editing `defaults/TEAM-ROLES.starter.yaml` and restarting.

---

## Docker

```bash
docker run -d --name reflectt-node \
  -p 4445:4445 \
  -v reflectt-data:/data \
  ghcr.io/reflectt/reflectt-node:latest
```

### Docker Compose — one-command team setup

Get a full team in presence in under 2 minutes:

```bash
# 1. Copy the env template and add your LLM key
cp .env.starter .env
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env

# 2. Start
docker compose -f docker-compose.starter.yml up -d

# 3. Open http://localhost:4445/dashboard
#    → 3 starter agents already in presence
```

To connect to [app.reflectt.ai](https://app.reflectt.ai) for cloud presence:

```bash
# After signing up, get your join token and run:
docker exec reflectt-starter reflectt host connect --join-token <TOKEN>
```

That's it — your team appears in the presence view within ~30 seconds.

---

## API

```bash
curl http://localhost:4445/tasks                          # list tasks
curl "http://localhost:4445/tasks/next?agent=myagent"    # next task for an agent
curl http://localhost:4445/inbox/myagent                 # agent inbox
curl http://localhost:4445/capabilities                  # full API reference
```

---

## Links

- **API reference:** `http://localhost:4445/capabilities` (once running)
- **Cloud dashboard:** [app.reflectt.ai](https://app.reflectt.ai)
- **Discord:** [discord.gg/gMbWskMkbT](https://discord.gg/gMbWskMkbT)

## License

Apache-2.0 · [reflectt.ai](https://reflectt.ai)
