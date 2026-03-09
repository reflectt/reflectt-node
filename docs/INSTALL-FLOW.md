# Install Flow Map

Visual map of the reflectt-node bootstrap and install paths.
Derived from `public/bootstrap.md` and `public/install.sh`.

---

## Decision Tree

```
User wants to install reflectt-node
│
├─ Has OpenClaw installed?
│  │
│  ├─ YES → Option C: curl installer
│  │        curl -fsSL https://www.reflectt.ai/install.sh | bash
│  │        (automated: clone → npm install → build → start → verify)
│  │
│  └─ NO → Choose manual path
│           │
│           ├─ Has Node.js 18+? → Option A: npm
│           │   npm install -g reflectt-node
│           │   reflectt init
│           │   reflectt start
│           │
│           └─ Has Docker? → Option B: Docker
│               docker run -d --name reflectt-node \
│                 -p 4445:4445 -v reflectt-data:/data \
│                 ghcr.io/reflectt/reflectt-node:latest
│
▼
Health check: curl http://127.0.0.1:4445/health
│
├─ FAIL → Check logs, retry, or switch install method
│
└─ OK → Continue setup
         │
         ▼
    Discover endpoints
    curl http://127.0.0.1:4445/capabilities
         │
         ▼
    Agent self-configuration
    curl http://127.0.0.1:4445/bootstrap/heartbeat/<agent_name>
         │
         ▼
    First-use checks
    ├─ Pull first task:  /tasks/next?agent=<name>&compact=true
    └─ Check inbox:      /inbox/<name>?compact=true
         │
         ▼
    Optional: Cloud sync
    reflectt host connect --join-token <token>
    (get token at app.reflectt.ai)
```

---

## Install Paths — Detail

### Option A: npm (simplest, no extra deps)

| Step | Command | What happens |
|------|---------|-------------|
| 1 | `npm install -g reflectt-node` | Installs CLI globally |
| 2 | `reflectt init` | Creates config at `~/.reflectt/` |
| 3 | `reflectt start` | Starts server on :4445 |

**Prerequisites:** Node.js 18+ (20+ recommended)

### Option B: Docker (isolated, no Node required)

| Step | Command | What happens |
|------|---------|-------------|
| 1 | `docker run ...` | Pulls image, starts container |

Exposes port 4445, persists data in `reflectt-data` volume.

**Prerequisites:** Docker

### Option C: curl installer (automated, requires OpenClaw)

| Step | What happens |
|------|-------------|
| 1 | Checks prerequisites: bash, curl, git, node, npm |
| 2 | Verifies OpenClaw is installed (fails with guidance if missing) |
| 3 | Clones `reflectt-node` to `~/.reflectt/reflectt-node/` |
| 4 | Runs `npm install` + `npm run build` |
| 5 | Starts server with `node dist/index.js` on :4445 |
| 6 | Polls `/health` up to 20 times (1s interval) |
| 7 | Verifies `/health`, `/health/agents`, `/tasks?limit=1` |
| 8 | Prints next-steps with endpoint discovery commands |

**Prerequisites:** OpenClaw, Node.js, git, curl, bash

**Environment overrides:**
- `REFLECTT_NODE_REPO` — custom repo URL
- `REFLECTT_NODE_DIR` — install directory (default: `~/.reflectt/reflectt-node`)
- `REFLECTT_NODE_BRANCH` — branch to checkout (default: `main`)
- `REFLECTT_NODE_PORT` — port (default: `4445`)

---

## Post-Install Flow

After any install path succeeds:

1. **Health check** — `GET /health` → `{"status":"ok"}`
2. **Endpoint discovery** — `GET /capabilities` returns all endpoints grouped by category (tasks, chat, inbox, insights, reflections, system) with usage hints
3. **Agent bootstrap** — `GET /bootstrap/heartbeat/<agent>` generates a tailored HEARTBEAT.md
4. **Heartbeat** — `GET /heartbeat/<agent>` returns active task + next task + inbox + queue counts + suggested action (~200 tokens)
5. **First task** — `GET /tasks/next?agent=<name>&compact=true`
6. **Inbox** — `GET /inbox/<name>?compact=true`
7. **Dashboard** — `http://127.0.0.1:4445/dashboard` (web UI)
8. **Cloud sync** (optional) — `reflectt host connect --join-token <token>`

---

## Failure Modes

| Failure | Cause | Fix |
|---------|-------|-----|
| `Missing required dependency: openclaw` | curl installer requires OpenClaw | Install OpenClaw first, then rerun |
| `Missing required dependency: node` | No Node.js | Install Node.js 18+ |
| Health check timeout | Server didn't start in 20s | Check `/tmp/reflectt-node-install.log` |
| API checks failed | Endpoints not responding | Check build errors, port conflicts |
| 404 on any route | Wrong URL | Any 404 returns a discovery page with valid endpoints |

---

## Tips

- Add `?compact=true` to most GET endpoints to reduce response size 50-75%
- Any 404 returns a markdown discovery page
- The heartbeat endpoint is the single best "what should I do?" call for agents
