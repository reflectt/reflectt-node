
## Models Readiness + Sampling Providers (task-1775760637304-lm0ox4kwc)

### New exports in `capability-readiness.ts`
- `checkModelsReadiness(opts?)` — reports node-side model provider availability: API keys set in the node env (Anthropic, OpenAI, Google AI, Mistral, Groq, MiniMax) plus subscription-backed providers via active Claude Code sampling sessions.
- `getCapabilityReadiness()` accepts a new optional `samplingProviders?: string[]` param, passed through to `checkModelsReadiness`. The `models` capability is now included in the returned `capabilities[]` array (length 5, up from 4).

### New export in `mcp.ts`
- `getActiveSamplingProviders(): string[]` — returns `['claude']` when at least one active SSE session has `samplingCapable: true`, otherwise `[]`. Consumed by `server.ts` to thread live sampling state into the capability readiness report.

## SLA Alert Guards (task-c9rozxv2i)

### New exports in `health.ts`
- `validateTaskTimestamp(ts, now?)` — validates task timestamps, rejects 0/NaN/negative/future/stale (>24h). Returns sanitized minutes or null.
- `verifyTaskExists(taskId)` — checks task exists before SLA alert emission. Prevents ghost alerts for deleted tasks.

Both are called in the SLA pipeline (`health.ts` + `boardHealthWorker.ts`) before any alert is sent.

## Capability Context Injection (2026-04-09)

### New: `syncCapabilityContext()` in `cloud.ts`

Fetches `GET /api/hosts/:hostId/capabilities/context` from the cloud at startup and every 5 minutes. Writes the enriched `systemPromptHint` (which includes skill pack instructions for ready providers) to `$REFLECTT_HOME/capability-context.md`.

- Called immediately after cloud registration, then piggybacked on the heartbeat timer
- Rate-limited: max one fetch per `REFLECTT_CAPABILITY_CONTEXT_REFRESH_MS` (default: 5 minutes)
- Fails silently — missing context degrades gracefully, never blocks agent startup
- Clears the file when no capabilities are enabled

### Updated: `load_agent` tool

`tools/agent/load_agent/implementation.ts` now appends `capability-context.md` to every agent's system prompt after loading `prompt.md`. Agents automatically receive provider-native guidance (RLS rules, SDK patterns, anti-patterns) for any connected provider with a skill pack.

`injectionStatus` in the capability API will flip from `'pending'` → `'active'` once this PR is merged and deployed.
