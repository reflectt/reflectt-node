# Quickstart — Zero to Chatting in Under 5 Minutes

This guide gets you from nothing to a working team with agents you can chat with.

**Prerequisites:** Node.js 22+ installed.

---

## Step 1: Install OpenClaw (~1 min)

```bash
npm install -g openclaw
openclaw setup        # Follow the interactive wizard
```

This installs the gateway (message router) and creates your config at `~/.openclaw/`.

## Step 2: Start reflectt-node (~2 min)

```bash
git clone https://github.com/reflectt/reflectt-node.git
cd reflectt-node
npm install && npm run build
npm start
```

Verify it's running:
```bash
curl http://127.0.0.1:4445/health
# → { "status": "ok", ... }
```

## Step 3: Create your starter team + run doctor (~1 min)

```bash
# Scaffold default agents (builder + ops)
curl -X POST http://127.0.0.1:4445/team/starter
# → { "success": true, "created": ["builder", "ops"], ... }

# Run the team doctor to check everything is connected
curl http://127.0.0.1:4445/health/team/doctor
# → { "overall": "pass", "checks": [...], "nextAction": null }
```

If the doctor reports failures, follow the `fix` instructions in each check.

## Step 4: Connect a chat channel (~1 min)

```bash
openclaw channels login    # Pick your channel (Telegram, Discord, Signal, etc.)
```

## Done! 🎉

You now have:
- A running reflectt-node with 2 starter agents
- A team doctor you can run anytime: `GET /health/team/doctor`
- A connected chat channel

**Next steps:**
- Send a message to your agents via chat
- Customize agent SOUL.md files in `~/.reflectt/data/agents/`
- Check team health: `GET /health/team`

---

## Timed Run (reference)

| Step | Command | Time |
|------|---------|------|
| Install OpenClaw | `npm i -g openclaw && openclaw setup` | ~60s |
| Clone + install + build | `git clone ... && npm i && npm run build` | ~90s |
| Start node | `npm start` | ~5s |
| Create starter team | `curl -X POST .../team/starter` | ~1s |
| Run doctor | `curl .../health/team/doctor` | ~1s |
| Connect channel | `openclaw channels login` | ~60s |
| **Total** | | **~4 min** |

*Tested on macOS with Node.js 22, broadband connection.*
