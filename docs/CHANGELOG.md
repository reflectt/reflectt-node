
## SLA Alert Guards (task-c9rozxv2i)

### New exports in `health.ts`
- `validateTaskTimestamp(ts, now?)` — validates task timestamps, rejects 0/NaN/negative/future/stale (>24h). Returns sanitized minutes or null.
- `verifyTaskExists(taskId)` — checks task exists before SLA alert emission. Prevents ghost alerts for deleted tasks.

Both are called in the SLA pipeline (`health.ts` + `boardHealthWorker.ts`) before any alert is sent.
