# Setup Audit — Zero to Working Team

## Current Steps (what a new user must do today)

### Phase 1: Install OpenClaw (~5 min)
1. Install Node.js 22+ (prerequisite)
2. `npm install -g openclaw` (CLI)
3. `openclaw setup` or `openclaw configure` (interactive wizard)
4. Configure gateway token + port

**Friction:** Requires Node.js pre-installed. `openclaw setup` vs `openclaw configure` vs `openclaw onboard` — 3 overlapping entry points.

### Phase 2: Install reflectt-node (~5 min)
5. `git clone https://github.com/reflectt/reflectt-node.git`
6. `cd reflectt-node && npm install`
7. `cp .env.example .env` + edit .env (PORT, HOST, gateway URL/token)
8. `npm run build`
9. `npm start` (or `npm run dev`)
10. Verify: `curl http://127.0.0.1:4445/health`

**Friction:** Manual git clone + npm install + .env copy + edit. Build step required. User must know to set gateway URL/token to match OpenClaw config.

### Phase 3: Configure agents (~10 min)
11. Create agent workspace directories
12. Write SOUL.md / AGENTS.md / HEARTBEAT.md per agent
13. Configure agent routing in OpenClaw (which channels → which agents)
14. Set up chat channels (Telegram/Discord/Signal/etc.) via `openclaw channels login`

**Friction:** Each agent needs manual workspace setup. No templates or scaffolding. Channel auth is per-provider and can be fiddly (QR codes, bot tokens, etc.).

### Phase 4: Connect to cloud (optional, ~5 min)
15. Get a join token from app.reflectt.ai
16. `reflectt host connect --join-token <token> --cloud-url https://app.reflectt.ai`
17. Verify enrollment in cloud dashboard

**Friction:** Join token flow requires cloud account first. CLI command is undiscoverable.

---

## Step Count Summary
| Phase | Steps | Technical? | Time |
|-------|-------|-----------|------|
| Install OpenClaw | 4 | Medium (Node.js, npm, CLI config) | ~5 min |
| Install reflectt-node | 6 | High (git, npm, .env, build) | ~5 min |
| Configure agents | 4 | High (workspace files, routing, channels) | ~10 min |
| Cloud connect | 3 | Medium (join token, CLI) | ~5 min |
| **Total** | **17** | **High** | **~25 min** |

---

## What Can Be Eliminated or Automated

### Quick wins (high impact, low effort)
1. **`openclaw init-team` command** — single command that:
   - Creates reflectt-node workspace (clone + install + build)
   - Generates .env from OpenClaw's existing config (gateway URL/token auto-detected)
   - Starts the node in background
   - Scaffolds 1-2 default agent workspaces with templates
   - **Eliminates steps 5-12** (~10 min saved)

2. **Auto-detect gateway config** — reflectt-node should read OpenClaw's config (`~/.openclaw/openclaw.json`) directly instead of requiring manual .env duplication. **Eliminates step 7.**

3. **`openclaw onboard` consolidation** — merge `setup`, `configure`, and `onboard` into one guided wizard that does everything in sequence. **Reduces confusion.**

4. **Pre-built binaries / npx** — `npx reflectt-node` or a single binary (pkg/bun compile) so users skip git clone + npm install + build entirely. **Eliminates steps 5-6, 8.**

### Medium effort
5. **Agent workspace templates** — `openclaw agents create <name>` scaffolds SOUL.md, HEARTBEAT.md, AGENTS.md from templates. **Eliminates steps 11-12.**

6. **Channel setup shortcuts** — `openclaw channels quick-setup` detects available channels and walks through auth. Fewer manual steps.

7. **Health check on first run** — after `npm start`, auto-run the health check and print a "✅ ready" message with next steps.

### Stretch (gets us to <5 min for non-developers)
8. **Docker one-liner** — `docker run -p 4445:4445 reflectt/reflectt-node` with env vars for config. Zero Node.js/npm/git required.

9. **Web-based setup wizard** — reflectt-node serves a first-run setup page at `/setup` that walks through config, agent creation, and channel connection in the browser.

10. **Cloud-first flow** — sign up at app.reflectt.ai → download agent → auto-configure everything. The cloud provisions the node config and pushes it down.

---

## Concrete Plan: Get Setup Under 5 Minutes

### Target flow (non-developer):
```
1. npm install -g openclaw          # 1 min (or brew install / curl script)
2. openclaw init-team               # 2 min (guided wizard)
   → installs reflectt-node
   → auto-configures .env from openclaw config
   → scaffolds default agents
   → starts node
   → prints dashboard URL
3. openclaw channels login           # 2 min (connect one chat channel)
```

**3 commands, ~5 minutes, no git/build/manual config required.**

### What needs to be built:
- [ ] `openclaw init-team` command (OpenClaw CLI plugin or built-in)
- [ ] Auto-detect gateway config in reflectt-node startup
- [ ] Agent workspace scaffolding templates
- [ ] Consolidate setup/configure/onboard entry points

### Stretch (gets to <2 min):
- [ ] `npx create-reflectt-team` (zero pre-install)
- [ ] Docker image
- [ ] Cloud-first auto-provision flow
