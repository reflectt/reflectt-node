# Internal URL Routing Findings — Staging Exploration (2026-04-13)

## Context
Explored staging node `rn-34faba44-d35k2b` (EnjoyVancouverIsland.com team) and `rn-b4c59013-5toqvf.fly.dev` (Fresh provisioned QA team).

## Key Findings

### 1. Search Endpoint — Works ✅
- **Endpoint:** `POST /search` on node directly
- **Returns:** Live Brave search results
- **Confirmed by:** Agent Tide on EnjoyVancouverIsland.com team
- **Gap:** Agents don't auto-discover the endpoint. Needs docs in team context so agents know to call `POST /search` for web search.

### 2. Identity — File-Based ✅
- Agents store identity in `IDENTITY.md` in their workspace
- All agents start in bootstrap mode (no pre-existing identity)
- When nudged, they set up identities in 2-30 seconds spontaneously
- Vista → Compass → Tide → Coast all followed the identity setup pattern when prompted

### 3. Browser Automation — NOT Available on Staging ⚠️
- **NOT observed** on staging nodes
- No Playwright/Chromium installation detected
- Only `web_fetch` available (raw HTTP, no JavaScript execution)
- This is a **product gap**, not a node config issue — staging nodes don't have browser automation built in

### 4. Canvas — Mobile Bridge Only ⚠️
- `canvas/index.html` serves as iOS/Android action bridge only
- **NOT a shared visual workspace** for agents and humans
- Image generation is one-way output to canvas
- No shared agent-human visual collaboration observed

### 5. Real Blocker: EnjoyVancouverIsland.com Deployment
- Site is **fully built** but needs GitHub/Netlify credentials to deploy
- No other blockers on that team

### 6. AGENTS.md Instruction Gap 🔴
- AGENTS.md told agents to call `PUT /config/team-roles` but didn't specify request format
- Endpoint needs `{"yaml": "...yaml content..."}` — returns 404 without the `yaml` field
- **This is a documentation/instruction gap, not a runtime bug**

## Internal URL Routing (for Agent Sandboxes)

### Mac Daddy (localhost)
- `REFLECTT_NODE_URL = http://127.0.0.1:4445` ✅ WORKS
- Agent sandbox can reach host localhost

### Fly-Managed Hosts (NOT YET VERIFIED)
- `REFLECTT_NODE_URL` needs Fly-internal address, not localhost
- Agents in Fly sandbox **cannot reach** `http://localhost:4445` on the host
- **VERIFICATION PENDING:** @rhythm needs to curl from inside Fly container:
  ```
  curl -s http://127.0.0.1:4445/health
  ```
- This affects: browser automation, search, canvas, and all node API calls from agent sandbox

## Recommendations

1. **Add `/search` to team context** — agents should know to call `POST /search` for web search
2. **Verify Fly internal routing** — critical for managed host functionality
3. **Document `PUT /config/team-roles` format** — needs `{"yaml": "..."}` wrapper
4. **Browser automation on staging** — needs Playwright/Chromium installation if agents need it

## Known Staging Nodes
- `rn-34faba44-d35k2b.fly.dev` — EnjoyVancouverIsland.com team (5 agents)
- `rn-b4c59013-5toqvf.fly.dev` — Fresh provisioned QA team (1 agent + kai)
