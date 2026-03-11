# OpenClaw Dependency Reduction Map

**Date:** 2026-03-11  
**Author:** link  
**Task:** task-1773265272133-t6p099pbz

## Overview

reflectt-node uses OpenClaw as the agent communication gateway. This document inventories every dependency, categorizes each as replaced/partially-replaced/still-needed, and identifies the next reduction cuts.

## Dependency Inventory

### 1. Gateway WebSocket Connection (`src/openclaw.ts`)
**Status: STILL NEEDED**

The gateway handles agent↔agent messaging, session management, and cross-device routing. reflectt-node connects via WebSocket to the OpenClaw gateway daemon.

- **What it does:** Routes messages between agents, handles heartbeats, provides session context
- **Files:** `src/openclaw.ts`, `src/config.ts`
- **Env vars:** `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_AGENT_ID`
- **Why still needed:** No Host-native agent messaging system exists yet. The gateway is the only way agents communicate.

### 2. Agent Chat Routing (`src/chat.ts`)
**Status: PARTIALLY REPLACED**

Chat messages flow through OpenClaw channels. However, reflectt-node now has its own SSE event system (`src/events.ts`) that can push events to subscribers.

- **Replaced by:** EventBus SSE (`canvas_input`, `canvas_render`, presence events)
- **Still needed for:** Multi-agent chat rooms, cross-host messaging, persistent message history with room semantics
- **Next cut:** Once Host has native agent-to-agent messaging, chat routing can bypass the gateway for local agents

### 3. Artifact Sharing (`src/artifact-mirror.ts`, `src/artifact-resolver.ts`)
**Status: STILL NEEDED**

Shared workspace artifacts (process/ files, design/ specs) are mirrored via OpenClaw's workspace mechanism.

- **What it does:** Reads/writes files from `~/.openclaw/workspace-shared`
- **Why still needed:** No Host-native shared filesystem or artifact store exists
- **Next cut:** Host artifact API (store/retrieve named artifacts per run) would replace this

### 4. Agent Context & Memory (`src/memory.ts`, `src/context-budget.ts`)
**Status: REPLACED**

Host now has its own persistent memory system.

- **Replaced by:** `agent_memories` table (migration v22), `GET/PUT/DELETE /agents/:agentId/memories`
- **Boot context:** PR #874 — memories + active run surfaced in heartbeat
- **Context budgets:** `GET /context/budgets` reads from Host data directly
- **Still uses OpenClaw for:** Agent identity resolution (who is "link"?) — reads from OpenClaw agent config

### 5. Agent Presence (`src/server.ts` — presence endpoints)
**Status: REPLACED**

Host manages its own agent presence.

- **Replaced by:** `POST /agents/:agentId/presence`, heartbeat tracking, 3-state presence (active/idle/offline)
- **PR #832:** Agent presence system with auto-expiry
- **Still uses OpenClaw for:** Initial agent roster discovery (which agents exist?)

### 6. Task System (`src/server.ts` — task endpoints)
**Status: REPLACED**

Fully Host-native. SQLite-backed task management.

- **Replaced by:** 598+ tasks managed entirely in Host DB
- **No OpenClaw dependency** for task CRUD, comments, history, assignments

### 7. Approval Routing
**Status: REPLACED**

- **Replaced by:** `GET /approvals/pending`, `POST /approvals/:id/decide`, `GET /approval-queue`
- **Canvas integration:** `POST /canvas/input` for decision actions
- **No OpenClaw dependency**

### 8. Agent Runs & Events
**Status: REPLACED**

- **Replaced by:** `agent_runs` + `agent_events` tables (migration v21), full CRUD + SSE streaming
- **No OpenClaw dependency**

### 9. Cost Visibility & Policy
**Status: REPLACED**

- **Replaced by:** `GET /usage/by-agent`, `GET /usage/summary`, agent config with cost caps
- **Cost enforcement:** `GET /agents/:agentId/cost-check` — warn/downgrade/deny
- **No OpenClaw dependency**

### 10. Workflow Templates
**Status: REPLACED**

- **Replaced by:** `GET/POST /workflows/:id/run` — reusable agent operating loops
- **No OpenClaw dependency**

### 11. Cloud Relay (`src/cloud.ts`)
**Status: STILL NEEDED**

Connects to `app.reflectt.ai` for cloud features (team management, host registration, email/SMS delivery).

- **What it does:** Host ↔ cloud API calls via `REFLECTT_HOST_TOKEN`
- **Not an OpenClaw dependency** — this is reflectt-cloud, not OpenClaw
- **Included for completeness**

### 12. Health & Doctor (`src/health.ts`, `src/doctor.ts`, `src/team-doctor.ts`)
**Status: PARTIALLY REPLACED**

Health checks reference OpenClaw gateway status. Doctor commands check gateway connectivity.

- **Still needed for:** Gateway health visibility
- **Next cut:** Once gateway dependency reduces, health checks simplify

### 13. Preflight & Request Tracking (`src/preflight.ts`, `src/request-tracker.ts`)
**Status: STILL NEEDED**

Preflight checks include OpenClaw gateway connectivity. Request tracker logs gateway-originated requests.

- **Next cut:** Simplifies as gateway dependency reduces

### 14. Insights Bridge (`src/insights.ts`)
**Status: PARTIALLY REPLACED**

Generates insights from reflections. Uses EventBus to bridge insight→task creation.

- **What's replaced:** EventBus handles the automation internally
- **What's still needed:** Agent identity for insight attribution comes from OpenClaw config

## Summary

| Category | Count | Status |
|----------|-------|--------|
| **Fully replaced by Host** | 6 | Tasks, Runs/Events, Approvals, Cost, Memory, Workflow |
| **Partially replaced** | 3 | Chat routing, Health/Doctor, Insights |
| **Still needed** | 3 | Gateway WebSocket, Artifact sharing, Preflight |
| **Not OpenClaw** | 1 | Cloud relay (reflectt-cloud) |

## Next 3 Reduction Cuts

### Cut 1: Agent Identity Resolution (Effort: Small — 1 PR)
**Currently:** Agent names and roles come from OpenClaw config YAML.  
**Replace with:** `agent_config` table (migration v23, already shipped in PR #882).  
**Effect:** Host can resolve "who is link?" without asking the gateway.

### Cut 2: Local Agent Messaging (Effort: Medium — 2-3 PRs)
**Currently:** Agent-to-agent messages route through the gateway.  
**Replace with:** Host-native message bus using EventBus SSE + a new `agent_messages` table.  
**Effect:** Local agents on the same Host talk directly. Gateway only needed for cross-host routing.

### Cut 3: Artifact Store (Effort: Medium — 2-3 PRs)
**Currently:** Shared files live in `~/.openclaw/workspace-shared`.  
**Replace with:** Host-native artifact API — `POST /artifacts`, `GET /artifacts/:id`, linked to runs.  
**Effect:** Artifacts are first-class Host objects, not filesystem paths. Enables artifact lifecycle (create → review → archive).

## Reduction Arc

```
Today:     Gateway (messaging + identity) ← NEEDED
           Artifacts (filesystem)         ← NEEDED  
           Chat (gateway routing)         ← PARTIALLY REPLACED
           
After cuts: Gateway (cross-host only)     ← REDUCED
           Identity (Host-native)         ← REPLACED
           Artifacts (Host API)           ← REPLACED
           Chat (local = Host, remote = gateway) ← MOSTLY REPLACED
```

The end state: OpenClaw gateway is only needed for cross-host agent routing. Everything else is Host-native.
