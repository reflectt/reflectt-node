# Quickstart — Zero to Chatting in Under 5 Minutes

This guide gets you from nothing to a working team with agents you can chat with.

Choose your path:
- **[Docker](#docker-quickstart)** — fastest, no Node.js required
- **[From source](#from-source)** — full control, requires Node.js 22+

---

## Docker Quickstart

### Option A: Pull from GHCR (recommended)

```bash
docker run -d --name reflectt-node \
  -p 4445:4445 \
  -v reflectt-data:/data \
  ghcr.io/reflectt/reflectt-node:latest
```

### Option B: docker-compose

```bash
git clone https://github.com/reflectt/reflectt-node.git
cd reflectt-node
docker compose up -d
```

Verify it's running:
```bash
curl http://127.0.0.1:4445/health
# → { "status": "ok", ... }
```

Open the dashboard: [http://localhost:4445/dashboard](http://localhost:4445/dashboard)

### Connecting to OpenClaw

To connect your Docker instance to an OpenClaw gateway, set these env vars:

```bash
docker run -d --name reflectt-node \
  -p 4445:4445 \
  -v reflectt-data:/data \
  -e OPENCLAW_GATEWAY_URL=ws://host.docker.internal:18789 \
  -e OPENCLAW_GATEWAY_TOKEN=your_token_here \
  ghcr.io/reflectt/reflectt-node:latest
```

### Troubleshooting: "unauthorized" on docker pull

If `docker pull ghcr.io/reflectt/reflectt-node:latest` returns **unauthorized**:

1. **Check if the image is public** — it should be. If you see this error, the org may not have published a public release yet.

2. **Authenticate with GHCR** (if the image is private):
   ```bash
   # Create a GitHub Personal Access Token (PAT) with read:packages scope
   # at https://github.com/settings/tokens
   echo YOUR_GITHUB_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
   docker pull ghcr.io/reflectt/reflectt-node:latest
   ```

3. **Build locally instead** (no auth needed):
   ```bash
   git clone https://github.com/reflectt/reflectt-node.git
   cd reflectt-node
   docker build -t reflectt-node .
   docker run -d --name reflectt-node -p 4445:4445 -v reflectt-data:/data reflectt-node
   ```

---

## From Source

**Prerequisites:** Node.js 22+ installed.

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
