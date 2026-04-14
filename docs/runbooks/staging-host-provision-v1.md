# Runbook — Provision and Verify a Fresh Staging Host

This runbook covers how to provision a new staging host and verify that the full bootstrap flow works end-to-end.

## Prerequisites

- Access to [app.staging.reflectt.ai](https://app.staging.reflectt.ai) (staging environment)
- Admin access to the `reflectt` Supabase project (staging)
- `flyctl` authenticated to the Reflectt Fly.io organization
- `gh` CLI authenticated to the `reflectt` GitHub org

---

## Step 1: Provision a New Host

### Via the Dashboard (Recommended)

1. Sign in to [app.staging.reflectt.ai](https://app.staging.reflectt.ai)
2. Navigate to **Hosts** → **Add Host**
3. Fill in:
   - **Team**: select the target team (or create a new one)
   - **Region**: choose the closest Fly.io region (e.g., `sJC` for US West)
   - **Description**: brief description of this host's purpose
4. Click **Provision**
5. Wait 60–90 seconds for the machine to start

### Via the API

```bash
# Get an invite token for your team
TOKEN=$(curl -s "https://api.staging.reflectt.ai/api/hosts/provision-token?teamId=<teamId>" \
  -H "Authorization: Bearer <your-token>" | jq -r '.token')

# Provision
flyctl machine run \
  --region sjc \
  --env TEAM_INTENT="<your team description>" \
  --env REFLECTT_CLOUD_URL="https://api.staging.reflectt.ai" \
  ghcr.io/reflectt/reflectt-node:latest
```

### Verify Provisioning Started

```bash
# Check host status
curl -s "https://api.staging.reflectt.ai/api/hosts?teamId=<teamId>" \
  -H "Authorization: Bearer <your-token>" | jq '.hosts[] | {id, status}'

# Expected: status should change from "provisioning" to "active" within 2-3 minutes
```

---

## Step 2: Verify Bootstrap

The bootstrap agent (`main`) starts automatically on first boot when `TEAM_INTENT` is set.

### 2a: Check that `main` agent is registered

```bash
# Via node API
curl -s "http://<host-ip>:4445/me/main" | jq '.agent'

# Expected: {"agent": "main", "status": "idle|working"}
```

### 2b: Check bootstrap task was created

```bash
curl -s "http://<host-ip>:4445/tasks?assignee=main&status=doing&limit=5" | jq '.tasks[].title'

# Expected: A P0/P1 task like "Bootstrap your team from the user's intent"
```

### 2c: Watch bootstrap happen in real-time

```bash
# Watch the chat for the bootstrap agent's intro message
curl -s "http://<host-ip>:4445/chat/messages?channel=general&limit=20" | jq '.messages[] | {from, content}'
```

Bootstrap agent should:
1. Call `GET /bootstrap/team` to get the team schema
2. Design agent roles based on TEAM_INTENT
3. Save the team via `PUT /config/team-roles`
4. Post an intro to `#general`

---

## Step 3: Verify Agent Spawning

After TEAM-ROLES.yaml is saved, the bootstrap agent should spawn configured agents via `sessions_spawn`.

### 3a: Check agents.json was updated

```bash
# On the host machine
cat ~/.openclaw/workspaces/default/agents.json | jq '.agents[].id'

# Expected: should list all agents from TEAM-ROLES.yaml (not just "main")
```

### 3b: Check spawned agent sessions

```bash
# Via OpenClaw gateway (on the host machine)
curl -s "http://localhost:18789/api/sessions" \
  -H "Authorization: Bearer <gateway-token>" | jq '.sessions[] | {agentId, status}'

# Or via node API
curl -s "http://<host-ip>:4445/agents" | jq '.agents[].name'
```

### 3c: Verify each agent is registered

```bash
# For each agent in TEAM-ROLES.yaml
curl -s "http://<host-ip>:4445/me/<agent-name>" | jq '.agent'

# Expected: agent info with status
```

---

## Step 4: Verify Capability Context

After bootstrap, the node syncs capability context from the cloud API.

### 4a: Check capability-context.md exists

```bash
# On the host machine
cat ~/.reflectt/capability-context.md

# Expected: markdown file starting with "## Team capabilities"
# Lists enabled capabilities: Browser, Email, SMS, etc.
```

### 4b: Check heartbeat includes capabilityContext

```bash
curl -s "http://<host-ip>:4445/heartbeat/main?compact=true" | jq '.capabilityContext'

# Expected: non-null string with capability details
```

### 4c: Check capability context in agent workspaces

```bash
# For each agent workspace
cat ~/.reflectt/workspace-<agent-name>/capability-context.md | head -5

# Expected: same content as ~/.reflectt/capability-context.md
```

---

## Step 5: Verification Checklist

| Check | Command | Expected Result |
|-------|---------|-----------------|
| Host status | `curl -s "https://api.staging.reflectt.ai/api/hosts/<hostId>" -H "Authorization: Bearer <token>" \| jq '.status'` | `"active"` |
| Main agent registered | `curl -s "http://<host>:4445/me/main" \| jq '.agent.agent'` | `"main"` |
| Bootstrap task exists | `curl -s "http://<host>:4445/tasks?assignee=main&status=doing" \| jq '.total'` | `>= 1` |
| TEAM-ROLES.yaml saved | `ssh <host> "cat ~/.reflectt/TEAM-ROLES.yaml" \| head -5` | valid YAML with `agents:` |
| agents.json updated | `ssh <host> "cat ~/.openclaw/workspaces/default/agents.json" \| jq '.agents \| length'` | `> 1` |
| Additional agents spawned | `curl -s "http://<host>:4445/agents" \| jq '.agents \| length'` | `> 1` |
| capability-context.md exists | `ssh <host> "cat ~/.reflectt/capability-context.md"` | non-empty markdown |
| Heartbeat has capabilityContext | `curl -s "http://<host>:4445/heartbeat/main" \| jq '.capabilityContext'` | non-null |
| Agent workspaces have capability-context | `ssh <host> "cat ~/.reflectt/workspace-*/capability-context.md" \| head -1` | `## Team capabilities` |

---

## Troubleshooting

### Bootstrap agent not spawning agents

1. Check the bootstrap agent's task comments for errors
2. Verify `sessions_spawn` is available: `curl -s "http://<host>:4445/capabilities" | jq '.categories[]'`
3. Check that `~/.openclaw/workspaces/default/agents.json` is writable

### capability-context.md is empty or missing

1. Check cloud connectivity: `curl -s "http://<host>:4445/cloud/status" | jq '.connected'`
2. Check capability sync errors: `curl -s "http://<host>:4445/cloud/status" | jq '.lastError'`
3. Manually trigger sync: the sync runs every 5 minutes automatically

### Agents can't reach node API from sandbox

- **Mac Daddy**: agents use `localhost:4445` ✅ works
- **Fly managed hosts**: agents in sandbox need Fly-internal address, NOT `localhost`

To verify on a Fly host:
```bash
# From inside the Fly container
curl -s http://127.0.0.1:4445/health

# If this returns 404, the issue is REFLECTT_NODE_URL not pointing to localhost
```

---

## Rollback

If a provision fails:

1. **Via dashboard**: Delete the host and re-provision
2. **Via API**:
   ```bash
   curl -X DELETE "https://api.staging.reflectt.ai/api/hosts/<hostId>" \
     -H "Authorization: Bearer <token>"
   ```

---

## Related

- [CLOUD_PROVISIONING.md](../CLOUD_PROVISIONING.md) — full provisioning flow
- [INTERNAL-URL-ROUTING-FINDINGS.md](../INTERNAL-URL-ROUTING-FINDINGS.md) — staging exploration findings

---

## Known Staging Hosts (2026-04-14)

| Host ID | URL | Team | Status | Verified |
|---------|-----|------|--------|----------|
| `rn-b4c59013-5toqvf` | `rn-b4c59013-5toqvf.fly.dev` | Fresh provisioned QA team | Active | ✅ |
| `rn-34faba44-d35k2b` | `rn-34faba44-d35k2b.fly.dev` | EnjoyVancouverIsland.com | Active | ✅ |

### Verification Results (2026-04-14)

**`rn-b4c59013-5toqvf.fly.dev` (Fresh QA team)**
- Bootstrap: ✅ Main agent starts and reads TEAM_INTENT
- Search: ✅ `POST /search` returns live Brave results
- Identity: ✅ Agents set up `IDENTITY.md` files when prompted
- Browser automation: ❌ NOT available on staging (no Playwright/Chromium)
- Canvas: ⚠️ Mobile bridge only, not a shared visual workspace

**`rn-34faba44-d35k2b.fly.dev` (EnjoyVancouverIsland.com)**
- Bootstrap: ✅ Main agent bootstraps successfully
- Team size: 5 agents (Compass, Tide, Vista, Coast + main)
- Real blocker: Needs GitHub/Netlify credentials to deploy site

### Key Gaps Found
1. **Browser automation** — Staging nodes don't have Playwright/Chromium installed. This is a product gap.
2. **Fly internal routing** — Agents on Fly managed hosts may not be able to reach `localhost:4445`. Verification pending @rhythm container check.
3. **AGENTS.md instruction gap** — `PUT /config/team-roles` needs `{"yaml": "..."}` wrapper format but AGENTS.md didn't specify this.
