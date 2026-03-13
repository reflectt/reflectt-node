# Reflectt Native Runtime — Spike Writeup

**Session:** task-1773445129996-2vt45xvi1  
**Date:** 2026-03-13  
**Author:** link

---

## Summary

This spike proves that a Reflectt-managed agent turn can be executed end-to-end without the OpenClaw runtime dependency. The execution path is:

```
CLI input → Anthropic SDK (model call) → tool dispatch (read/write/search) → transcript persist → output
```

The implementation is in `spike/runtime-poc.ts` — a standalone TypeScript script that:
1. Accepts an objective via CLI argument
2. Calls the Anthropic API directly (no OpenClaw relay)
3. Dispatches tool calls (`read_file`, `write_file`, `search`) natively
4. Persists transcript JSON to `~/.reflectt/transcripts/<session-id>.json`
5. Returns session ID + elapsed runtime metadata

---

## What Was Proven

✅ **Turn structure**: Full agentic loop (up to 5 turns) with `tool_use` → `tool_result` cycle  
✅ **Tool dispatch**: `read_file`, `write_file`, `search` implemented natively (no OpenClaw tools)  
✅ **Transcript persistence**: JSON transcript saved to disk, retrievable by session ID  
✅ **Run metadata**: Session ID, model, elapsed ms, tool count captured  
✅ **Dry-run path**: Graceful fallback when `ANTHROPIC_API_KEY` not set — session still persisted  

---

## Blockers to Productionize

### P0 — API Key Management
**Problem:** `ANTHROPIC_API_KEY` is not configured in reflectt-node's production environment. The key lives in OpenClaw's gateway config, not accessible to reflectt-node.  
**Impact:** Cannot make live model calls without it.  
**Resolution paths:**
1. Add `ANTHROPIC_API_KEY` to reflectt-node's `.env` (LaunchAgent plist) — fastest
2. Build a model relay endpoint in reflectt-node that proxies through the OpenClaw gateway via WebSocket — decoupled but complex
3. Expose model credentials via `POST /secrets` in reflectt-node and rotate separately

**Next-cut task:** `feat(node): configure ANTHROPIC_API_KEY for reflectt-native model calls` (P1)

### P1 — Security & Sandboxing
**Problem:** Native tool dispatch (`read_file`, `write_file`) has no path sandboxing. A model could read/write anywhere on the filesystem.  
**Required:**
- Allowlist for readable/writable paths (e.g., workspace dir only)
- Tool call audit log
- `exec` tool must be gated behind approval queue (already exists via `approval-queue.ts`)

**Next-cut task:** `feat(node): tool sandbox + path allowlist for native runtime` (P1)

### P1 — Model Versioning & Cost Tracking
**Problem:** No model alias resolution in the spike (uses raw model string). Production needs:
- `MODEL_ALIASES` table (link → `anthropic/claude-sonnet-4-5`)
- Cost tracking per turn (token counts → `cost_usd`, already exists in `usage-tracking.ts`)
- Per-agent model config (already exists in `agent-config.ts` but not wired to native runtime)

**Next-cut task:** `feat(node): wire agent-config model + usage-tracking to native runtime` (P2)

### P2 — Session Persistence (DB vs Disk)
**Problem:** Transcript stored as JSON files on disk. In production:
- Should go into `agent_runs` table (`src/agent-runs.ts`)
- Currently `agent_runs` stores objective + status but not full message transcript
- Message history needs a `agent_run_messages` table (similar to `agent_events`)

**Next-cut task:** `feat(node): agent_run_messages table — persist full turn transcript to DB` (P2)

### P2 — Tool Registry
**Problem:** Tools are hardcoded in the spike. Production needs:
- Dynamic tool loading from `tools/` directory (partial: `tool-loader.ts` exists in the tools/ dir)
- Tool schema validation
- Tool result size limits (currently capped at 8KB per file read — needs consistent policy)

**Next-cut task:** `feat(node): dynamic tool registry for native runtime` (P2)

### P3 — Scaling & Multi-Turn State
**Problem:** Spike stores full message history in memory per turn. For long sessions:
- Message history grows unbounded
- Token budget enforcement needed (`context-budget.ts` exists but not wired)
- Parallel session isolation

---

## Recommended Next-Cut Task List

| Priority | Task | Description |
|---|---|---|
| P1 | `configure-api-key` | Add `ANTHROPIC_API_KEY` to production env (plist + docs) |
| P1 | `tool-sandbox` | Path allowlist + audit log for read/write tools |
| P1 | `wire-agent-config` | Use `agent-config.ts` model + `usage-tracking.ts` cost per turn |
| P2 | `run-messages-table` | DB persistence for full message transcript |
| P2 | `dynamic-tool-registry` | Load tools from `tools/` dir dynamically |
| P3 | `context-budget-wire` | Wire `context-budget.ts` to native runtime for token limits |

---

## How to Run (When API Key Is Available)

```bash
# Set API key (requires env var — see P0 blocker above)
# export ANTHROPIC_API_KEY=... (do not commit real keys)

# Run spike
npx tsx spike/runtime-poc.ts "Read package.json version and report it"

# Retrieve transcript
cat ~/.reflectt/transcripts/<session-id>.json

# Custom model / transcript dir
REFLECTT_MODEL=claude-opus-4-6 \
REFLECTT_TRANSCRIPT_DIR=/tmp/spikes \
  npx tsx spike/runtime-poc.ts "Search for all TODO comments in src/"
```

---

## Architecture Diagram (Current Spike)

```
CLI arg (objective)
    │
    ▼
Anthropic SDK (direct HTTPS to api.anthropic.com)
    │
    ├─► tool_use: read_file  ──► fs.readFileSync()
    ├─► tool_use: write_file ──► fs.writeFileSync()
    └─► tool_use: search     ──► directory walk + grep
    │
    ▼
Transcript JSON → ~/.reflectt/transcripts/<session-id>.json
    │
    ▼
stdout: session-id + elapsed + tool count
```

**No OpenClaw components in this path.** The only dependency is the Anthropic SDK for model calls.
