
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
