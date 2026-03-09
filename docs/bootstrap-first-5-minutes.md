# Bootstrap: first 5 minutes (copy/paste)

Goal: **zero → running dashboard + health check + your first “next task” call**.

Pick one install path:

- **Docker** (fastest / most reliable)
- **npm** (if you already have Node.js)
- **curl installer** (automated; requires OpenClaw)

---

## 0) Pick a port (optional)

Default is **4445**.

If you already have something on 4445, pick another port (example: 5555). Replace `4445` below.

---

## 1) Start reflectt-node

### Option A — Docker (recommended)

```bash
docker run -d --name reflectt-node \
  -p 4445:4445 \
  -v reflectt-data:/data \
  ghcr.io/reflectt/reflectt-node:latest
```

### Option B — npm (CLI)

Prereq: Node.js **20+**.

```bash
npm install -g reflectt-node
reflectt init     # one-time: creates ~/.reflectt/
reflectt start
```

### Option C — curl installer (automated)

Prereq: **OpenClaw installed** (this installer refuses to install OpenClaw for you).

```bash
curl -fsSL https://www.reflectt.ai/install.sh | bash
```

What it does: clone → `npm install` → build → start → verify `/health` + core endpoints.

---

## 2) Verify health (must be green)

```bash
curl -fsS http://127.0.0.1:4445/health
```

Expected:

```json
{ "status": "ok" }
```

If that fails:

- Docker: `docker logs reflectt-node --tail 200`
- npm: re-run `reflectt start` and read the output

---

## 3) Open the dashboard

- Local: http://localhost:4445/dashboard
- Remote VPS: http://YOUR_SERVER_IP:4445/dashboard

---

## 4) Doctor (self-serve diagnostics)

### Option A — HTTP (works everywhere)

```bash
curl -fsS http://127.0.0.1:4445/health/team/doctor
```

### Option B — CLI

```bash
reflectt doctor --url http://127.0.0.1:4445
```

You want **overall=pass** (or at least clear “next action” hints).

---

## 5) First agent call (prove tasks API works)

> zsh users: keep the URL in quotes so `?agent=...` isn’t treated as a glob.

```bash
curl -fsS "http://127.0.0.1:4445/tasks/next?agent=builder&compact=true"
```

If you get `{ "task": null }`, that’s fine — it means there’s no ready task.

---

## 6) Discover what else exists (capabilities)

```bash
curl -fsS http://127.0.0.1:4445/capabilities
```

Tip: add `?compact=true` to many GET endpoints to reduce response size.

---

## 7) (Optional) Agent bootstrap + heartbeat

```bash
# Generate an optimal HEARTBEAT.md for an agent
curl -fsS http://127.0.0.1:4445/bootstrap/heartbeat/builder

# Single compact heartbeat (~200 tokens)
curl -fsS http://127.0.0.1:4445/heartbeat/builder
```

---

## 8) (Optional) Connect OpenClaw + a chat channel

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
- If reflectt-node is in Docker, pass `OPENCLAW_GATEWAY_URL` + `OPENCLAW_GATEWAY_TOKEN` (see step 8)
- Re-run:

```bash
curl -fsS http://127.0.0.1:4445/health/team/doctor
```

---

## Reference

- Canonical full guide: `docs/GETTING-STARTED.md`
- Install flow map (what each install option does): `docs/INSTALL-FLOW.md`
