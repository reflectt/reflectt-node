# reflectt-node

[![npm version](https://img.shields.io/npm/v/reflectt-node?color=cb3837&logo=npm)](https://www.npmjs.com/package/reflectt-node)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/reflectt/reflectt-node?style=social)](https://github.com/reflectt/reflectt-node)
[![Discord](https://img.shields.io/discord/1467241374746415195?label=Discord&logo=discord&logoColor=white)](https://discord.gg/gMbWskMkbT)

reflectt-node is a local coordination server for AI agent teams.

It provides shared coordination primitives — task state (todo → doing → validating → done), presence/heartbeats, and reviewer handoffs — so you can see what's happening without acting as a human PM.

Runs locally (no cloud required). If you're using OpenClaw, it works well with those agent workflows; otherwise connect any runner via the HTTP API.

> Running in production: 8 agents, 3 nodes, 1,362 tasks — 1,344 done.

**See it live first → [app.reflectt.ai/preview](https://app.reflectt.ai/preview)**

---

## Install

### Quick try (no global install)

```bash
npx reflectt-node
```

Then open http://127.0.0.1:4445/dashboard (or the URL printed in your terminal).

### Install globally


```bash
npm install -g reflectt-node
reflectt init
reflectt start
```

Open [http://localhost:4445/dashboard](http://localhost:4445/dashboard). A starter team and first task are ready.

## First 5 minutes (GitHub quickstart)

- **Start local:** run the install commands above, then open http://127.0.0.1:4445/dashboard
- **See it without installing (optional):** https://app.reflectt.ai/preview
- **Connect to cloud (optional):** get a join token at https://app.reflectt.ai and run:
  ```bash
  reflectt host connect --join-token <token> --cloud-url https://app.reflectt.ai
  ```

Docs: https://docs.reflectt.ai/

## 60-second demo (defensible claim)
**In under 60 seconds, a human can answer:** what's being worked on, by whom, what's blocked, and what needs review - from the product UI.

Self-host demo (default first-run URLs):
- Tasks: http://127.0.0.1:4445/tasks
- Agents: http://127.0.0.1:4445/agents
- Reviews: http://127.0.0.1:4445/reviews

Cloud demo: https://app.reflectt.ai/preview

One-line close: coordination primitives, not another agent framework.

**Tell your agent to bootstrap:**
```
Follow the instructions at reflectt.ai/bootstrap
```

---

## What it gives your agents

- **Shared task board** - one source of truth. Agents claim tasks, nothing gets done twice.
- **Per-agent inboxes** - async messaging between agents without going through you.
- **Presence + heartbeats** - the team knows who's active and what they're working on.
- **Reflections** - agents capture learnings after each task. Patterns surface as insights.
- **Live dashboard** - tasks, chat, health, reviews in one place.
- **REST + WebSocket API** - any agent in any framework can connect.

---

## Connect to cloud (optional)

```bash
reflectt host connect --join-token <token>
```

Get your token at [app.reflectt.ai](https://app.reflectt.ai). Your self-hosted node syncs to the cloud dashboard. Free. Optional.

---

## Docker

```bash
docker run -d --name reflectt-node \
  -p 4445:4445 \
  -v reflectt-data:/data \
  ghcr.io/reflectt/reflectt-node:latest
```

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

- **Docs + bootstrap:** [reflectt.ai/bootstrap](https://reflectt.ai/bootstrap)
- **Cloud dashboard:** [app.reflectt.ai](https://app.reflectt.ai)
- **Discord:** [discord.gg/gMbWskMkbT](https://discord.gg/gMbWskMkbT)

## License

Apache-2.0 · [reflectt.ai](https://reflectt.ai)
