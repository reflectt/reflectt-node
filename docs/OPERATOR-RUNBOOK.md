# reflectt-node Operator Runbook

> Single source of truth for operating a reflectt-node instance. Covers diagnosis, debugging, updates, and escalation.

**Start here for any host issue:** `curl -s http://<host>:4445/doctor`

---

## Quick Reference

| Problem | Command |
|---------|---------|
| "Is the node healthy?" | `curl -s http://<host>:4445/doctor` |
| "Why did it restart?" | `curl -s http://<host>:4445/health/errors` + `flyctl logs` |
| "What version is running?" | `curl -s http://<host>:4445/health/version` |
| "Are agents online?" | `curl -s http://<host>:4445/agents` |
| "Bootstrap stalled?" | `curl -s http://<host>:4445/doctor` → bootstrap status |
| "Update the node?" | See [Update Procedure](#update-procedure) |

---

## Staging Fleet Truth

> The 5 kept staging pairs (as of 2026-04-15). Each pair = one Fly machine (rn-*) + its router gateway (rg-*). For health checks on all 5, see [Fleet Health Check](#fleet-health-check).

### Active Proof Pair

| App | Machine ID | Region | Purpose |
|-----|-----------|--------|---------|
| `rn-34faba44-wlgkeq` + `rg-34faba44-ilajjh` | `568354e7ad5348` | sjc | **Live E2E proof box** — the canonical staging node. Has persistent volume, health checks, ~9.5h current uptime. All staging verifications use this host. |

Canonical proof setup:
- **team**: `34faba44-1932-4791-a80a-d2f19b1ea4e3`
- **host**: `0617a28f-b1aa-469c-bcf5-4c678bbccfe6`
- **node**: `rn-34faba44-wlgkeq`

### Other Staging Nodes (Scale-to-0 / Recovery Candidates)

These hosts were restarted ~2 min ago (2026-04-15 23:57 UTC) for recovery operations. All are `shared-cpu-1x:256MB`, no persistent volume, no health checks:

| App | Machine ID | Current State |
|-----|-----------|---------------|
| `rn-fb9d33fe-7hffu2` | `148e06e2b7d058` | Scale-to-0 candidate |
| `rn-b1964d01-fhdmps` | `e7841665a27e28` | Scale-to-0 candidate |
| `rn-51b65766-xzsj19` | `32872d90f06218` | Scale-to-0 candidate |
| `rn-cb2eeb02-ek57z4` | `3d8d2e07ae1928` | Scale-to-0 candidate |

### How to Verify Fleet State

```bash
# Quick health check all 5
for app in rn-34faba44-wlgkeq rn-fb9d33fe-7hffu2 rn-b1964d01-fhdmps rn-51b65766-xzsj19 rn-cb2eeb02-ek57z4; do
  result=$(curl -s "https://$app.fly.dev/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''), d.get('uptime_seconds',0))" 2>/dev/null || echo "OFFLINE")
  echo "$app: $result"
done

# Check which host has a volume (active proof box)
flyctl volumes list --app rn-34faba44-wlgkeq 2>/dev/null
```

---

## Diagnosis

### First: Run /doctor

```bash
curl -s http://<host>:4445/doctor | python3 -m json.tool
```

`/doctor` returns structured diagnoses for:
- **bootstrap** — is team setup complete?
- **crash_loop** — is the node restarting repeatedly?
- **agents** — are agents online?
- **channel** — is OpenClaw gateway configured?
- **errors** — what's the error rate?

Each diagnosis includes a `status`: `pass`, `warn`, or `fail`. If `healthy: false`, check `next_action` for the first recovery step.

### Deeper: /health endpoints

```bash
# Full health + stats
curl -s http://<host>:4445/health | python3 -m json.tool

# Error details
curl -s http://<host>:4445/health/errors | python3 -m json.tool

# Version + uptime
curl -s http://<host>:4445/health/version

# All endpoints
curl -s http://<host>:4445/capabilities
```

### Health Check Script

Save as `health-check.sh` and run against any host:

```bash
#!/bin/bash
HOST=${1:-localhost:4445}
echo "=== Health Check: $HOST ==="
echo ""
echo "--- Doctor ---"
curl -s http://$HOST/doctor
echo ""
echo "--- Version ---"
curl -s http://$HOST/health/version
echo ""
echo "--- Agents ---"
curl -s http://$HOST/agents | python3 -c "
import sys, json
d = json.load(sys.stdin)
agents = d if isinstance(d, list) else d.get('agents', [])
online = [a for a in agents if a.get('status') == 'online']
print(f'{len(online)}/{len(agents)} agents online')
"
```

---

## Logs

See full doc: [OPERATOR-NODE-LOGS.md](./OPERATOR-NODE-LOGS.md)

### Accessing Logs

| Environment | Command |
|------------|---------|
| Fly.io managed | `flyctl logs --app <app-name>` |
| Docker | `docker logs <container-name>` |
| macOS LaunchAgent | `tail -f /tmp/reflectt-node.log` |
| systemd (Linux) | `journalctl -u reflectt-node -f` |

### Common Log Patterns

```
# Normal startup
reflectt-node ready — v0.1.33

# Bootstrap events
[bootstrap] Creating main bootstrap agent
[bootstrap] Bootstrap complete

# Error patterns
[db] SQLite error: database is locked
[cloud] Failed to reach https://app.reflectt.ai: connection refused

# Crash loop
Node started at <timestamp>
Node started at <timestamp>  # repeated immediately = crash loop
```

### Debug Mode

```bash
export REFLECTT_LOG_LEVEL=debug
# Then restart the node
```

---

## Update Procedure

See full doc: [OPERATOR-NODE-UPDATE.md](./OPERATOR-NODE-UPDATE.md)

### Quick Update (Fly.io)

```bash
flyctl deploy --app <app-name> -i ghcr.io/reflectt/reflectt-node:latest
```

### Quick Update (Docker)

```bash
docker pull ghcr.io/reflectt/reflectt-node:latest
docker restart <container-name>
```

### Quick Update (NPM/macOS)

```bash
npm update -g reflectt-node
launchctl kickstart -k gui/$(id -u)/com.reflectt.node
```

### Verify Update

```bash
curl -s http://<host>:4445/health/version | grep version
```

---

## Bootstrap Stall

See full analysis: [BOOTSTRAP-STALL-ANALYSIS.md](./BOOTSTRAP-STALL-ANALYSIS.md)

### Signs of Bootstrap Stall

- `/doctor` shows bootstrap status != "complete" after 5+ minutes
- Only `main` agent online, no other agents from TEAM-ROLES.yaml
- Main agent stuck on P0 bootstrap task

### Diagnosis

```bash
# Check bootstrap status
curl -s http://<host>:4445/doctor | python3 -m json.tool | grep -A3 bootstrap

# Check roster
curl -s http://<host>:4445/bootstrap/roster | python3 -m json.tool

# Check if agents are spawned
for agent in sage rhythm link; do
  curl -s http://<host>:4445/me/$agent | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'$agent: {d.get(\"id\", \"NOT FOUND\")}')"
done
```

### Root Cause

Bootstrap stall had **two independent root causes**, both now fixed:

1. **Agents not spawned** — After saving TEAM-ROLES.yaml, main agent did NOT spawn configured agents. Fixed by [PR #2341](https://github.com/reflectt/reflectt-node/pull/2341) — bootstrap agent now calls `sessions_spawn` for each roster agent after writing team roles.

2. **HEARTBEAT.md action ignored** — Seeded HEARTBEAT.md told agents to curl `/heartbeat/:agent` but gave no instruction to act on the `action` field. Agents received `action: "Claim task-..."` but never claimed tasks. Fixed by [PR #2357](https://github.com/reflectt/reflectt-cloud/pull/2357) — HEARTBEAT.md seed now explicitly instructs: *"If `action` starts with `Claim task-`: immediately claim and execute that task."*

3. **Fly Machines API wrong endpoint** — Bootstrap used `POST /machines/:id/update` which doesn't exist. Fixed by [PR #2357](https://github.com/reflectt/reflectt-cloud/pull/2357) — corrected to `POST /machines/:id`.

### Fix Verification (Fresh Host)

A properly bootstrapped host should have:
- `GET /doctor` → `healthy: true`
- `GET /doctor` → bootstrap status = "complete"
- `GET /me/<each-roster-agent>` → 200 (not 404)
- `GET /agents` → all roster agents present
- Main agent **acts on `action` field** — check task inbox for main agent activity

---

## Crash Loop Detection

### Signs

- Node keeps restarting (uptime < 5 min)
- High error rate on `/health/errors`
- `flyctl logs` shows repeated "Node started at" messages

### Diagnosis

```bash
curl -s http://<host>:4445/doctor | python3 -m json.tool | grep crash_loop
curl -s http://<host>:4445/health/errors | python3 -m json.tool | grep error_rate
flyctl logs --app <app-name> | grep -i "panic\|crash\|error"
```

### Recovery

1. Check `flyctl logs` for panic traces
2. Verify `node --version` compatibility (requires Node >= 20)
3. Check disk space / memory
4. Rollback if needed: `flyctl rollback --app <app-name>`

---

## Fleet Health Check

> Run this to verify all 5 staging hosts are healthy. Expected: 1 active proof box (rn-34faba44-wlgkeq) + 4 scale-to-0 candidates.

```bash
# Check all 5 hosts
for app in rn-34faba44-wlgkeq rn-fb9d33fe-7hffu2 rn-b1964d01-fhdmps rn-51b65766-xzsj19 rn-cb2eeb02-ek57z4; do
  curl -s "https://$app.fly.dev/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status'), d.get('uptime_seconds'))" 2>/dev/null || echo "OFFLINE"
done
```

**What to expect:**
- `rn-34faba44-wlgkeq`: `ok` with high uptime (active proof box)
- Other 4: `ok` with low uptime (scale-to-0, recently restarted)

**Alert if:**
- Any host returns `OFFLINE`
- Any host has error rate >10%
- Active proof box shows unexpected status

---

## Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /doctor` | Structured diagnosis with recovery tips |
| `GET /health` | Full health + version + stats |
| `GET /health/errors` | Error rate, top buckets, recent errors |
| `GET /health/version` | Version + uptime |
| `GET /agents` | List agents + presence |
| `GET /bootstrap/roster` | Agents defined in TEAM-ROLES.yaml |
| `GET /me/:agent` | Check if specific agent is registered |
| `GET /tasks` | Task queue counts |
| `GET /capabilities` | All available endpoints |

---

## Staging Recovery Lessons Learned

> Lessons from staging host recovery operations (April 2026).

### Rule 1: One-Host-First

When recovering a staging host:
1. **Diagnose on-staging first** — use `flyctl logs` and `/doctor` on the staging host before touching anything
2. **Test the fix on one host only** — apply changes to a single staging node, verify, then proceed
3. **Never mass-apply config changes** — config edits to `~/.reflectt/` on one host don't propagate

### Rule 2: Config Preservation

Before restarting or rebuilding a staging host:
- **Backup `~/.reflectt/`** — config, data dir, TEAM-ROLES.yaml
- **Backup `~/.openclaw/`** — agent identities, workspace configs
- **Document what's different** from a fresh provisioned host

```bash
# Backup before touching a staging host
ssh user@<staging-host> "tar -czf /tmp/reflectt-backup-$(date +%Y%m%d).tar.gz ~/.reflectt ~/.openclaw"
```

### Rule 3: Bootstrap Stall Diagnosis

If a freshly provisioned host stalls at bootstrap:

**Symptoms:**
- `/doctor` shows bootstrap status != "complete" after 5+ minutes
- Only `main` agent online, no other agents
- `flyctl logs` shows main agent heartbeat loop but no task progress

**Root causes seen in staging:**

| Root Cause | Fix |
|-----------|-----|
| `TEAM_INTENT` env var not set on host | Provisioning flow must include `TEAM_INTENT` in machine env |
| Bootstrap HEARTBEAT.md missing `action` field instructions | Seeded HEARTBEAT.md must include actionable `action` field |
| Bootstrap task P0 stuck in 'doing' | Check main agent heartbeat for blockers |

**Diagnosis steps:**
```bash
# Check what env vars are set on the host
flyctl ssh issue --app <app-name> "env | grep REFLECTT"

# Check bootstrap task
curl -s http://<host>:4445/tasks?status=doing | python3 -m json.tool

# Check main agent heartbeat
curl -s http://<host>:4445/heartbeat/main | python3 -m json.tool
```

### Rule 4: Version Consistency

When deploying to staging:
- Verify the image tag before deploying: `ghcr.io/reflectt/reflectt-node:latest`
- Check current version on host before updating
- If rollback needed: `flyctl rollback --app <app-name>`

```bash
# Check what version is currently running
curl -s http://<host>:4445/health/version

# Check what image is deployed
flyctl image show --app <app-name>
```

### Rule 5: Don't Guess — Verify

When a host behaves unexpectedly:
1. **Verify before fixing** — run `/doctor` and check logs before making changes
2. **One change at a time** — if multiple things look wrong, fix one and verify before the next
3. **Document what you found** — if it took you 30 minutes to figure out, write it down so the next person doesn't have to

---

## Related Documentation

| Doc | Topic |
|-----|-------|
| [OPERATOR-NODE-LOGS.md](./OPERATOR-NODE-LOGS.md) | Log access patterns and common log patterns |
| [OPERATOR-NODE-UPDATE.md](./OPERATOR-NODE-UPDATE.md) | Version check and update procedures |
| [OPERATOR-NODE-HEALTH-CHECKS.md](./OPERATOR-NODE-HEALTH-CHECKS.md) | Health check endpoints and debug script |
| [BOOTSTRAP-STALL-ANALYSIS.md](./BOOTSTRAP-STALL-ANALYSIS.md) | Bootstrap stall root cause and verification |
| [CLOUD_PROVISIONING.md](./CLOUD_PROVISIONING.md) | Host provisioning flow |
| [HEALTH_ENDPOINTS_OPERATOR_CHEAT_SHEET.md](./HEALTH_ENDPOINTS_OPERATOR_CHEAT_SHEET.md) | Health endpoint quick reference |

---

## Escalation

If `/doctor` shows `healthy: false` and the recovery steps don't resolve the issue:

1. **Collect evidence**: `/doctor` output, `/health/errors` output, logs
2. **Check for known issues**: [KNOWN_ISSUES.md](./KNOWN_ISSUES.md)
3. **Post to #blockers** with:
   - Host ID
   - `/doctor` output
   - What you tried
   - How long the issue has been occurring
