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

## See it in 60 seconds

After starting, you can immediately answer: what's being worked on, by whom, what's blocked, what needs review.

Self-host (default first-run URLs):
- Tasks: http://127.0.0.1:4445/tasks
- Agents: http://127.0.0.1:4445/agents
- Reviews: http://127.0.0.1:4445/reviews

Live demo: https://app.reflectt.ai/preview

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
