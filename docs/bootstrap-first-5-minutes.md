# Bootstrap: first 5 minutes (copy/paste)

This gets you from **zero → running dashboard + self-serve doctor output**.

Assumptions:
- You have Docker installed **or** Node.js 22+.
- You’re using the official image: `ghcr.io/reflectt/reflectt-node:latest` (public).

---

## 1) Start reflectt-node (fastest: Docker)

```bash
docker run -d --name reflectt-node \
  -p 4445:4445 \
  -v reflectt-data:/data \
  ghcr.io/reflectt/reflectt-node:latest
```

Sanity check:
```bash
curl -s http://127.0.0.1:4445/health | jq
```

## 2) Open the dashboard URL

- Local: **http://localhost:4445/dashboard**
- Remote VPS: **http://YOUR_SERVER_IP:4445/dashboard**

## 3) Run doctor (self-serve diagnostics)

### Option A — HTTP (works everywhere)

```bash
curl -s http://127.0.0.1:4445/health/team/doctor | jq
```

### Option B — CLI (if you installed reflectt-node from source/npm)

```bash
reflectt doctor --url http://127.0.0.1:4445
```

You want **overall=pass** (or at least clear “next action” hints).

## 4) (Optional) Connect OpenClaw + a chat channel

If you want agents to message you (Telegram/Discord/Signal/etc.), set up OpenClaw:

```bash
npm i -g openclaw
openclaw setup
openclaw gateway start
openclaw channels login
```

If reflectt-node is in Docker and OpenClaw is on your host:

```bash
# Get your gateway token on the host:
openclaw config get gateway.auth.token

docker rm -f reflectt-node

docker run -d --name reflectt-node \
  -p 4445:4445 \
  -v reflectt-data:/data \
  -e OPENCLAW_GATEWAY_URL=ws://host.docker.internal:18789 \
  -e OPENCLAW_GATEWAY_TOKEN=YOUR_GATEWAY_TOKEN \
  ghcr.io/reflectt/reflectt-node:latest
```

---

# Troubleshooting (top 3)

## 1) `docker pull ... unauthorized`

The official image is **public**. If you’re using a fork/private org, authenticate:

```bash
# PAT needs read:packages
echo YOUR_GITHUB_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

docker pull ghcr.io/reflectt/reflectt-node:latest
```

Or build locally:
```bash
git clone https://github.com/reflectt/reflectt-node.git
cd reflectt-node

docker build -t reflectt-node .
docker run -d --name reflectt-node -p 4445:4445 -v reflectt-data:/data reflectt-node
```

## 2) Dashboard won’t load / `connection refused`

```bash
docker ps | grep reflectt-node || true
curl -v http://127.0.0.1:4445/health
```

Common fixes:
- Port in use: `lsof -i :4445` → stop the other process or change the port mapping (e.g. `-p 5555:4445`).
- Container not running: `docker logs reflectt-node --tail 200`

## 3) Doctor says OpenClaw/gateway/channel is missing

This is normal if you only started reflectt-node.

Fix:
- Run `openclaw setup` then `openclaw gateway start`
- If reflectt-node is in Docker, pass `OPENCLAW_GATEWAY_URL` + `OPENCLAW_GATEWAY_TOKEN` (see step 4)
- Re-run:
  ```bash
  curl -s http://127.0.0.1:4445/health/team/doctor | jq
  ```

---

## What “good” looks like

- `/health` returns `{ "status": "ok" }`
- Dashboard loads at `/dashboard`
- `/health/team/doctor` returns a single actionable report (no mystery failures)
