
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
