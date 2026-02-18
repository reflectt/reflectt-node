# reflectt-node API Reference

Base URL: `http://localhost:4445`

## Quickstarts

- [Tasks API Quickstart](../docs/TASKS_API_QUICKSTART.md) — create → doing → validating → done with current status contract and curl examples.
- [Known Issues](../docs/KNOWN_ISSUES.md) — verified runtime/docs drift with repro, workaround, and owner.
- [Reviewer Handoff Bundle Template](../docs/REVIEWER_HANDOFF_BUNDLE_TEMPLATE.md) — reviewer-ready QA bundle format.
- [Task Creation Template](../docs/TASK_CREATION_TEMPLATE.md) — high-signal task spec + anti-patterns.
- [Reviewer-Ready Tasks Guide](../docs/REVIEWER_READY_TASKS_GUIDE.md) — short operational guide to reduce QA churn.
- [Dashboard Task Field Reference](../docs/DASHBOARD_TASK_FIELD_REFERENCE.md) — task-card field mapping, null semantics, and UI edge cases.
- [Task Comments API Quickstart](../docs/TASK_COMMENTS_API_QUICKSTART.md) — POST/GET task comments with QA checklist.
- [Release Endpoints Guide](../docs/RELEASE_ENDPOINTS_GUIDE.md) — /release/status, /release/notes, /release/deploy workflow.
- [Review Queue SOP](../docs/REVIEW_QUEUE_SOP.md) — validating queue workflow, SLA, and PASS/FAIL discipline.
- [Task-Close Gate Playbook](../docs/TASK_CLOSE_GATE_PLAYBOOK.md) — required close metadata with pass/fail examples.
- [Backlog Claim Troubleshooting](../docs/BACKLOG_CLAIM_TROUBLESHOOTING.md) — claim flow, metadata requirements, and common errors.
- [Health Endpoints Operator Cheat Sheet](../docs/HEALTH_ENDPOINTS_OPERATOR_CHEAT_SHEET.md) — compact endpoint-by-endpoint triage reference.
- [Health Endpoints Map](../docs/HEALTH_ENDPOINTS_MAP.md) — endpoint selector for /health, /health/team, /health/agents, and debug paths.
- [Watchdog Behavior Explainer](../docs/WATCHDOG_BEHAVIOR_EXPLAINER.md) — idle/cadence/mention rescue behavior with cooldown + debug flow.
- [OpenClaw 2026.2.13 Memory Search Rollout Note](../docs/OPENCLAW_2026_2_13_MEMORY_SEARCH_ROLLOUT_NOTE.md) — what changed, impact, caveats, and safe usage pattern.
- [Research Intake Handbook](../docs/RESEARCH_INTAKE_HANDBOOK.md) — requests/findings flow and handoff protocol.
- [Dashboard Panel Reference](../docs/DASHBOARD_PANEL_REFERENCE.md) — panel-to-endpoint mapping and refresh behavior.
- [API Docs Quality Checklist](../docs/API_DOCS_QUALITY_CHECKLIST.md) — pre-merge checks for endpoint-doc consistency.
- [Weekly Ship Log Template](../docs/WEEKLY_SHIP_LOG_TEMPLATE.md) — compact weekly status template.
- [Incident Writeup Template](../docs/INCIDENT_WRITEUP_TEMPLATE.md) — timeline/root-cause/fix/prevention structure.
- [Contributor Onboarding Script](../docs/CONTRIBUTOR_ONBOARDING_SCRIPT.md) — first-day workflow from clone to validated task.

---

## Error Envelope (all endpoints)

All API errors normalize to:

```json
{
  "success": false,
  "error": "human-readable message",
  "code": "BAD_REQUEST|NOT_FOUND|CONFLICT|...",
  "status": 400,
  "hint": "optional fix guidance"
}
```

For 4xx errors, `hint` is included by default to speed up client-side troubleshooting.

## Rate limiting (`429` / `Retry-After`)

Core `reflectt-node` routes do not currently apply built-in per-route throttling in-process.

Operationally:
- If you see `429 Too Many Requests`, it is typically from an upstream gateway/proxy layer.
- If `Retry-After` is present, follow that value before retrying.
- Retry strategy recommendation: exponential backoff + jitter for idempotent reads.

## Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | System health — task counts, chat stats, inbox stats |
| GET | `/team/health` | Team config linter status for `~/.reflectt/TEAM.md`, `TEAM-ROLES.yaml`, `TEAM-STANDARDS.md` (issues, role coverage, last check timestamp) |
| GET | `/health/team` | Team health metrics with compliance + `staleDoing` snapshot. Per-agent rows include `activeTaskTitle` and `activeTaskPrLink` when an agent has a doing task with PR evidence. Flagged agents also include `actionable_reason` (last comment age, last transition, last mention age, suggested action). |
| GET | `/health/agents` | Per-agent health summary (`last_seen`, `active_task`, `heartbeat_age_ms`, `last_shipped_at`, `stale_reason`, state) |
| GET | `/health/compliance` | Compliance check results |
| GET | `/health/system` | System info (uptime, memory, versions) |
| GET | `/health/build` | Build/runtime identity (version, git SHA, branch, build timestamp, PID, uptime) |
| GET | `/health/deploy` | Deploy attestation payload for dashboards (`version`, `gitSha`, `branch`, `buildTimestamp`, `startedAt`, `pid`) |
| GET | `/health/team/summary` | Compact team health summary |
| GET | `/health/team/history` | Historical team health data |
| GET | `/health/workflow` | Unified per-agent workflow state: doing-task age, last shipped timestamp, blocker flag, artifact path, and linked PR state |
| GET | `/health/mention-ack` | Mention-ack lifecycle metrics (pending, timeout, latency counters) |
| GET | `/health/mention-ack/recent` | Recent mention-ack entries for debugging. Query: `limit` (max 100) |
| GET | `/health/mention-ack/:agent` | Pending mention-ack entries for one agent |
| POST | `/health/mention-ack/check-timeouts` | Run timeout sweep and return timed-out mention entries |
| GET | `/health/idle-nudge/debug` | Idle-nudge watchdog debug state |
| POST | `/health/idle-nudge/tick` | Trigger idle-nudge evaluation |
| POST | `/health/cadence-watchdog/tick` | Trigger cadence watchdog |
| POST | `/health/mention-rescue/tick` | Trigger mention-rescue fallback |

### Quiet hours behavior (watchdogs)

Watchdog endpoints currently execute whenever called (manual or scheduled). Quiet-hours suppression is not enforced by these endpoints at the API layer yet.

If your deployment needs quiet-hours behavior today, enforce it in scheduler/gateway policy (for example: only trigger watchdog ticks during allowed windows).

## Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks` | List tasks. Query: `status`, `assignee`, `agent`, `priority`, `limit`, `updatedSince` |
| GET | `/tasks/:id` | Get task by ID. Also accepts unambiguous ID prefixes. Ambiguous prefix returns `400` with full-ID suggestions. |
| GET | `/tasks/:id/history` | Status changelog for task lifecycle transitions. Returns `history[]` entries shaped as `{ status, changedBy, changedAt, metadata }` for each status transition. |
| GET | `/tasks/:id/comments` | List task discussion comments. Returns `{ comments, count }` |
| POST | `/tasks/:id/comments` | Add task comment. Body: `{ "author": "agent", "content": "text" }` |
| GET | `/tasks/:id/pr-review` | PR review quality panel data. Returns diff scope, CI checks, done criteria alignment. Requires PR URL in task metadata (`pr_url`, `qa_bundle.pr_link`, or in `artifacts`). |
| POST | `/tasks/:id/outcome` | Capture 48h checkpoint verdict for completed tasks. Body: `verdict` (`PASS`\|`NO-CHANGE`\|`REGRESSION`), optional `author`, `notes` |
| POST | `/tasks/:id/review-bundle` | Auto-build reviewer packet by resolving PR URL + CI + artifact evidence from task metadata. Returns normalized `verdict` (`pass`/`fail`) and reasons. Optional body: `author`, `strict` (default `true`, requires CI=`success`). |
| POST | `/tasks/:id/review` | Reviewer decision endpoint. Body: `{ "reviewer": "agent", "decision": "approve|reject", "comment": "..." }`. Only the assigned reviewer may submit. Updates task metadata with reviewer decision + approval flag. |
| POST | `/tasks` | Create task. Required: `title`, `createdBy`, `assignee`, `reviewer`, `done_criteria` (string[]), `eta`. Optional: `description`, `priority` (P0-P3), `status`, `tags`, `metadata`. Status contract: `validating` also requires `metadata.artifact_path` and it must be repo-relative under `process/` (e.g. `process/TASK-...md`). |
| PATCH | `/tasks/:id` | Update task (partial). Any task field, plus optional `actor` for history attribution. Status contract: `doing` requires reviewer + `metadata.eta`; `validating` requires `metadata.artifact_path` under `process/` (workspace-agnostic). |
| DELETE | `/tasks/:id` | Delete task |
| GET | `/tasks/next` | Pull-based assignment. Query: `agent` |
| GET | `/me/:agent` | Agent "My Now" cockpit payload: assigned tasks, pending reviews, blockers, failing-check signals, since-last-seen changelog, and next action |
| GET | `/tasks/intake-schema` | Task intake schema discovery — returns required/optional fields and per-type templates |
| GET | `/tasks/templates/:type` | Get task creation template for a specific type (e.g. `feature`, `bug`, `chore`) |
| GET | `/tasks/search` | Keyword search across task `title` + `description` (case-insensitive). Query: `q`, optional `limit` |
| GET | `/tasks/analytics` | Task completion analytics and velocity |
| GET | `/tasks/instrumentation/lifecycle` | Reviewer/done-criteria gates + status-contract violations (`doing` missing ETA, `validating` missing artifact path) |
| POST | `/tasks/batch-create` | Batch create up to 20 tasks. Body: `{ "tasks": [...], "createdBy": "agent", "deduplicate": true, "dryRun": false }`. Each task follows the same schema as `POST /tasks`. Returns per-task results (created/duplicate/error) with summary counts. Deduplication checks exact title match + fuzzy word overlap (Jaccard >0.6) against active tasks. |
| GET | `/tasks/board-health` | Board-level health metrics for backlog replenishment. Returns per-agent breakdown (doing, validating, todo, active counts), `needsWork`/`lowWatermark` flags, and `replenishNeeded` trigger (fires when 2+ agents idle or <3 backlog tasks). |
| GET | `/agents/roles` | Agent role registry with live WIP status. Returns all agents with `name`, `role`, `affinityTags`, `protectedDomains`, `wipCap`, `wipCount`, `overCap`. |
| POST | `/tasks/suggest-assignee` | Suggest best assignee for a task. Body: `{ "title": "...", "tags": [...], "done_criteria": [...] }`. Returns `suggested` agent name, `scores` array with affinity/WIP/throughput breakdown, and `protectedMatch` if a protected domain applies. |
| GET | `/team/manifest` | Serve TEAM.md from `~/.reflectt/` (falls back to defaults). Returns `manifest` object with `raw_markdown`, parsed `sections` array, `version` (SHA-256 hash), `updated_at`, `path`, and `source`. |

### Lane-state transition metadata (required on guarded transitions)

`PATCH /tasks/:id` enforces transition metadata for lane-locked transitions:

- `doing -> blocked` requires:
  - `metadata.transition.type = "pause"`
  - `metadata.transition.reason`
- `blocked -> doing` requires:
  - `metadata.transition.type = "resume"`
  - `metadata.transition.reason`
- `doing -> doing` with assignee change (handoff) requires:
  - `metadata.transition.type = "handoff"`
  - `metadata.transition.reason`
  - `metadata.transition.handoff_to` (must match new `assignee`)

If missing/invalid, API returns `400` with `Lane-state lock: ...` validation errors.

## Recurring Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks/recurring` | List recurring task definitions |
| POST | `/tasks/recurring` | Create recurring task definition |
| PATCH | `/tasks/recurring/:id` | Update recurring task definition (supports `enabled` toggle and schedule updates) |
| DELETE | `/tasks/recurring/:id` | Delete recurring task definition |
| POST | `/tasks/recurring/materialize` | Materialize due recurring tasks; skips creation when previous instance is still open. Query: `force=true` to override skip guard |

## Backlog (Self-Serve)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks/backlog` | Unassigned todo tasks ranked by priority then age. Returns `{ tasks, count }` |
| POST | `/tasks/:id/claim` | Self-assign a task → moves to "doing". Body: `{ "agent": "name" }`. Rejects if already assigned |

## Release / Deploy

| Method | Path | Description |
|--------|------|-------------|
| GET | `/release/status` | Compare startup code snapshot vs current repo state. Returns `stale` + reasons for code/server mismatch detection. |
| GET | `/release/notes` | Generate deploy changelog from completed tasks. Query: `since` (epoch ms), `limit`. Returns markdown + structured task list. |
| GET | `/release/diff` | Compare live SHA vs previous deploy SHA. Returns changed files, inferred endpoint changes, changed tests, commits, and PR links. Query: `from`, `to`, `commitLimit`. |
| POST | `/release/deploy` | Mark deploy timestamp + tracked commit SHA. Body (optional): `{ "deployedBy": "agent", "note": "text" }` |

## Chat

| Method | Path | Description |
|--------|------|-------------|
| GET | `/chat/ws` | WebSocket — real-time chat |
| GET | `/ws/stats` | WebSocket heartbeat stats (connections, ping/pong health, cleanup stats) |
| POST | `/chat/messages` | Post message. Body: `from` (required), `content` (required), `channel`, `replyTo` |
| GET | `/chat/messages` | Message history. Query: `channel`, `limit`, `before`, `after` |
| PATCH | `/chat/messages/:id` | Edit message (author-only). Body: `from`, `content` |
| DELETE | `/chat/messages/:id` | Delete message (author-only). Body: `from` |
| POST | `/chat/messages/:id/react` | React to message. Body: `emoji`, `agent`, `remove` |
| GET | `/chat/messages/:id/reactions` | Get reactions |
| GET | `/chat/channels` | List channels (includes `general`, `decisions`, `shipping`, `reviews`, `blockers`) |
| GET | `/chat/search` | Search messages. Query: `q`, `channel`, `from`, `limit` |
| GET | `/chat/messages/:id/thread` | Get thread replies |
| GET | `/chat/rooms` | List rooms |
| POST | `/chat/rooms` | Create room |

### Chat edit/delete contract

- `PATCH /chat/messages/:id` and `DELETE /chat/messages/:id` are author-only.
- Request body must include `from` matching the original message author.
- Non-author attempts return an error envelope (`403`), and unknown message IDs return `404`.

## Inbox

| Method | Path | Description |
|--------|------|-------------|
| GET | `/inbox/:agent` | Get inbox. Query: `limit`, `since` (epoch ms), `channel` |
| POST | `/inbox/:agent/ack` | Acknowledge messages. Body: `{ "upTo": epochMs }` |
| POST | `/inbox/:agent/subscribe` | Replace channel subscriptions. Body: `{ "channels": ["reviews", "blockers"] }` |
| GET | `/inbox/:agent/subscriptions` | List subscriptions |
| GET | `/inbox/:agent/unread` | Unread count |
| GET | `/inbox/:agent/mentions` | Get @mentions |

## Presence

| Method | Path | Description |
|--------|------|-------------|
| GET | `/presence` | All agents' presence |
| GET | `/presence/:agent` | Single agent presence |
| POST | `/presence/:agent` | Update presence. Body: `{ "status": "working|idle|blocked|reviewing|offline" }` |
| GET | `/presence/:agent/focus` | Get agent focus state (active, level, expiry) |
| POST | `/presence/:agent/focus` | Toggle focus mode. Body: `{ "active": true, "level": "soft|deep", "durationMin": 60, "reason": "shipping PR" }`. Soft: suppresses system nudges, allows direct mentions. Deep: suppresses everything except blocker/review pings. |

## Memory

| Method | Path | Description |
|--------|------|-------------|
| GET | `/memory/:agent` | Get all memory files |
| POST | `/memory/:agent` | Save memory. Body: `{ "content": "..." }` |
| GET | `/memory/:agent/search` | Search memory. Query: `q` |

## Semantic Search

| Method | Path | Description |
|--------|------|-------------|
| GET | `/search/semantic` | Semantic search across indexed tasks and chat messages. Query: `q` (required), `limit`, `type` (`task`\|`chat`) |
| GET | `/search/semantic/status` | Vector index status — availability and counts by source type |
| POST | `/search/semantic/reindex` | Bulk reindex all existing tasks for semantic search |

## Experiments

| Method | Path | Description |
|--------|------|-------------|
| POST | `/experiments` | Create experiment |
| GET | `/experiments/active` | List active experiments |

## Research

| Method | Path | Description |
|--------|------|-------------|
| GET | `/research/requests` | List research requests. Query: `status`, `owner`, `category`, `limit` |
| POST | `/research/requests` | Create research request. Body: `title`, `question`, `requestedBy`; optional: `owner`, `category`, `priority`, `taskId`, `dueAt`, `slaHours` |
| GET | `/research/findings` | List findings. Query: `requestId`, `author`, `limit` |
| POST | `/research/findings` | Add finding linked to request. Body: `requestId`, `title`, `summary`, `author`; optional `artifactUrl`, `confidence`, `highlights[]` |
| POST | `/research/handoff` | Structured research→execution handoff that auto-creates a task. Required: `requestId`, `findingIds[]`, `title`, `summary`, `assignee`, `reviewer`, `eta`. Returns linked task + source metadata. |

## Content

| Method | Path | Description |
|--------|------|-------------|
| POST | `/content/published` | Record published content |
| GET | `/content/published` | List published content |
| GET | `/content/published/:id` | Get content piece |
| PATCH | `/content/published/:id/performance` | Update performance metrics |
| GET | `/content/calendar` | Calendar entries |
| POST | `/content/calendar` | Create calendar entry |
| GET | `/content/calendar/:id` | Get calendar entry |
| DELETE | `/content/calendar/:id` | Delete calendar entry |
| GET | `/content/stats` | Publishing statistics |
| GET | `/content/performance` | Overall performance metrics |

## Events (SSE)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/events/subscribe` | SSE stream for real-time updates. Query: `agent`, `topics` (comma-separated), `types` (exact event type filter, comma-separated) |
| GET | `/events` | SSE alias of `/events/subscribe` (used by reflectt-channel plugin) |
| GET | `/events/types` | List valid event types for SSE `?types=` filtering |
| GET | `/events/status` | Event system status |
| GET | `/events/config` | Get event config |
| POST | `/events/config` | Update event config (`batchWindowMs`) |

## Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/agents/activity` | All agents activity summary |
| GET | `/agents/:agent/activity` | Single agent activity |
| GET | `/activity` | Global activity feed |
| GET | `/analytics/foragents` | forAgents.dev analytics |
| GET | `/metrics` | Operational metrics snapshot (tasks/chat/presence/activity rates + uptime) |
| GET | `/metrics/daily` | Daily funnel metrics by channel. Query: `timezone` (IANA tz, default `America/Vancouver`) |
| GET | `/metrics/summary` | Aggregated metrics |
| GET | `/logs` | Server logs. Query: `limit`, `level` |

## MCP

| Method | Path | Description |
|--------|------|-------------|
| GET | `/sse` | MCP SSE transport |
| POST | `/mcp/messages` | MCP message handler |

## Database

| Method | Path | Description |
|--------|------|-------------|
| GET | `/db/status` | SQLite database status (engine, WAL mode, schema version, table row counts including `sync_ledger`) |

## Cloud

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cloud/status` | Cloud connection state (registered, heartbeat age, sync status). Only active when `REFLECTT_HOST_TOKEN` is set. |
| POST | `/cloud/reload` | Hot-reload cloud config from `~/.reflectt/config.json` without server restart. Updates env vars and restarts heartbeat/sync loops. Used by CLI after `host connect` enrollment. |
| GET | `/provisioning/status` | Host provisioning state: phase, enrollment, config/secrets pull status, webhook routes. Dashboard-safe (no credentials). |
| POST | `/provisioning/provision` | Full provisioning flow: enroll with cloud (join token or API key), pull config + secrets, configure webhooks. Body: `{ cloudUrl, hostName, joinToken?, apiKey?, capabilities? }`. |
| POST | `/provisioning/refresh` | Re-pull config + secrets + webhooks from cloud. Requires existing enrollment. |
| POST | `/provisioning/reset` | Reset provisioning state for re-enrollment. Clears hostId, credential, and all provisioning data. |
| GET | `/provisioning/webhooks` | List configured webhook routes for this host. |
| POST | `/provisioning/webhooks` | Add a webhook route. Body: `{ provider, path?, events?, active? }`. |
| DELETE | `/provisioning/webhooks/:id` | Remove a webhook route by ID. |
| POST | `/webhooks/incoming/:provider` | Receive incoming webhooks from external providers (GitHub, Stripe, etc.). Auto-routes through delivery engine to configured targets. Returns 202 Accepted. |
| POST | `/webhooks/deliver` | Enqueue a webhook for durable delivery. Body: `{ provider, eventType, payload, targetUrl, idempotencyKey?, metadata? }`. Returns event with idempotency key. |
| GET | `/webhooks/events` | List webhook events. Query: `status`, `provider`, `limit`, `offset`. |
| GET | `/webhooks/events/:id` | Get a webhook event by ID. |
| POST | `/webhooks/events/:id/replay` | Replay a webhook: re-enqueue with new idempotency key. Original preserved in audit trail. |
| GET | `/webhooks/dlq` | Dead letter queue: list permanently failed webhook deliveries. Query: `limit`. |
| GET | `/webhooks/stats` | Webhook delivery statistics: counts by status, config, oldest pending. |
| PATCH | `/webhooks/config` | Update webhook delivery config (maxAttempts, backoff, retention, timeout, concurrency). |
| GET | `/webhooks/idempotency/:key` | Lookup webhook event by idempotency key. |
| GET | `/portability/export` | One-click export: team config, server config (redacted), encrypted secrets, webhook routes, provisioning state. |
| GET | `/portability/export/download` | Download export bundle as JSON file attachment. |
| POST | `/portability/import` | Import from export bundle. Body: `{ bundle, overwrite?, skipSecrets?, skipConfig? }`. Rehydrates ~/.reflectt/ on a new host. |
| GET | `/portability/manifest` | Preview what would be exported (file list, counts, no content). |
| GET | `/notifications/preferences` | List all agents' notification preferences. |
| GET | `/notifications/preferences/:agent` | Get notification preferences for a specific agent. |
| PATCH | `/notifications/preferences/:agent` | Update notification preferences (partial). Body: `{ enabled?, deliveryMethod?, priorityThreshold?, quietHours?, eventFilters?, channelSubscriptions? }`. |
| DELETE | `/notifications/preferences/:agent` | Reset preferences to defaults. |
| POST | `/notifications/preferences/:agent/mute` | Mute notifications. Body: `{ durationMs? }` or `{ until? }`. Default: 1 hour. |
| POST | `/notifications/preferences/:agent/unmute` | Unmute notifications. |
| POST | `/notifications/route` | Check if notification should be delivered.
| GET | `/connectivity/status` | Cloud connectivity state: mode (connected/degraded/offline), failure counts, queue depth, transition history. |
| PATCH | `/connectivity/thresholds` | Update connectivity thresholds (degradedAfterFailures, offlineAfterMs, recoveryAfterSuccesses). |
| POST | `/connectivity/simulate-failure` | Simulate cloud failure for outage drill. Body: `{ reason?, count? }`. |
| POST | `/connectivity/simulate-success` | Simulate cloud success for recovery testing. Body: `{ count? }`. |
| POST | `/connectivity/reset` | Reset connectivity state to connected. |
| GET | `/board-health/status` | Board health worker status: config, running state, tick count, recent actions, rollbackable actions. |
| GET | `/board-health/audit-log` | Audit log of all automated board actions. Query: `?limit=N&since=timestamp&kind=auto-block-stale\|suggest-close\|digest-emitted`. |
| POST | `/board-health/tick` | Manually trigger board health tick. Query: `?dryRun=true` for preview. |
| POST | `/board-health/rollback/:actionId` | Rollback an automated action within the rollback window. Body: `{ by? }`. |
| PATCH | `/board-health/config` | Update worker config at runtime. Fields: enabled, intervalMs, staleDoingThresholdMin, suggestCloseThresholdMin, rollbackWindowMs, digestIntervalMs, digestChannel, quietHoursStart, quietHoursEnd, dryRun, maxActionsPerTick. |
| POST | `/board-health/prune` | Prune old audit log entries. Query: `?maxAgeDays=7`. |
| GET | `/feed/:agent` | Since-last-seen change feed. Query: `?since=timestamp&limit=100&kinds=task_status_changed,mention&includeGlobal=true`. Returns unified timeline of task changes, comments, mentions, PRs, deploys relevant to agent. |
| GET | `/policy` | Get unified policy config (quiet hours, idle nudge, cadence watchdog, board health, escalation thresholds). |
| PATCH | `/policy` | Update policy config at runtime (deep-merged, persisted to ~/.reflectt/policy.json). Propagates to running workers. |
| POST | `/policy/reset` | Reset policy to defaults + env overrides. |
| GET | `/routing/stats` | Message routing stats: total routed, by channel/category/severity, general vs ops count. |
| GET | `/approval-queue` | Pending tasks with confidence scores and agent suggestions. Returns `{ items[], total, highConfidenceCount, needsReviewCount }`. |
| POST | `/approval-queue/:taskId/approve` | Approve a task. Body: `{ assignedAgent?, priorityOverride?, note?, reviewedBy }`. |
| POST | `/approval-queue/:taskId/reject` | Reject a task. Body: `{ reason?, reviewedBy }`. |
| POST | `/approval-queue/batch-approve` | Batch approve high-confidence tasks. Body: `{ taskIds[], reviewedBy }`. |
| GET | `/routing-policy` | Current agent affinity maps from TEAM-ROLES.yaml. Returns `{ agents[], version, source }`. |
| PUT | `/routing-policy` | Update agent affinity maps. Body: `{ agents[{ agentId, affinityTags[], weight, ... }], updatedBy }`. Writes to `~/.reflectt/TEAM-ROLES.yaml`. |
| POST | `/feedback` | Submit user feedback. Body: `{ category: "bug"\|"feature"\|"general", message (10-1000 chars), email?, url?, siteToken }`. Rate limited 5/min/IP. |
| GET | `/feedback` | List feedback. Query: `status=new\|triaged\|archived\|all`, `category`, `sort=date\|votes`, `order`, `limit`, `offset`. |
| GET | `/feedback/:id` | Get single feedback record. |
| PATCH | `/feedback/:id` | Triage feedback. Body: `{ status?, notes?, assignedTo? }`. |
| POST | `/feedback/:id/vote` | Upvote feedback. |
| GET | `/widget/feedback.js` | Embeddable feedback widget (Shadow DOM, self-contained). Embed: `<script src="/widget/feedback.js" data-token="..." data-theme="auto">`. |
| GET | `/routing/log` | Recent routing decisions. Query: `?limit=50&since=timestamp&category=watchdog-alert&severity=warning`. |
| POST | `/routing/resolve` | Dry-run route resolution. Body: `{ from, content, severity?, category?, taskId?, mentions? }`. Returns where message would go. |
| POST | `/tasks/:id/precheck` | Precheck task transition. Body: `{ targetStatus }`. Returns required fields, auto-defaults, and a PATCH template. |
| GET | `/health/watchdog/suppression` | Watchdog de-noise config: show all suppression rules, thresholds, and what activity types prevent re-firing. | Body: `{ agent, type, priority?, channel?, message? }`. Returns routing decision + reason. |
| GET | `/runtime/truth` | Canonical environment snapshot for operators: repo/branch/SHA, runtime host+port+PID+uptime, deploy drift, cloud registration/heartbeat, and `REFLECTT_HOME` path. |

## Team

| Method | Path | Description |
|--------|------|-------------|
| GET | `/team/manifest` | Team charter manifest from `~/.reflectt/TEAM.md`. Returns parsed sections, version hash, update timestamp, and raw markdown. Returns `404` if TEAM.md is missing with creation hint. |
| GET | `/team/roles` | TEAM-ROLES routing matrix — agent skills, affinity scores, WIP caps |

## Other

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard` | HTML dashboard UI |
| GET | `/docs` | This API reference |
| GET | `/openclaw/status` | OpenClaw connection status |
| GET | `/secrets` | List all secrets (metadata only — no plaintext values) |
| POST | `/secrets` | Create/update a secret (encrypts locally, stores ciphertext) |
| GET | `/secrets/export` | Export all secrets as encrypted bundle for portability |
| GET | `/secrets/audit` | Secret access audit log |
| GET | `/secrets/:name` | Decrypt and return a secret value (audit logged) |
| DELETE | `/secrets/:name` | Revoke/delete a secret |
| POST | `/secrets/:name/rotate` | Rotate a secret's encryption key |
| GET | `/analytics/models` | Model performance analytics — tasks per model, avg cycle time, review pass rate |
| GET | `/analytics/agents` | Per-agent analytics — model used, performance stats |

---

*Manually curated from source routes. Base: http://localhost:4445*
| GET | `/telemetry` | Full telemetry snapshot (config + metrics) |
| GET | `/telemetry/config` | Telemetry configuration (safe — no secrets) |
| POST | `/api/telemetry/ingest` | Cloud telemetry ingest endpoint (receives snapshots from hosts) |
| POST | `/canvas/render` | Push content to a canvas slot (Screen Contract v0 validated) |
| GET | `/canvas/slots` | Current active (non-stale) slots |
| GET | `/canvas/slots/all` | All slots including stale (debug) |
| GET | `/canvas/history` | Recent render history (?slot=&limit=) |
| GET | `/canvas/rejections` | Recent contract validation rejections |
| GET | `/canvas/stream` | SSE stream of canvas render events |
| GET | `/execution-health` | Execution sweeper status: validating queue violations, SLA breaches, escalation tracking. |
| POST | `/pr-event` | PR state webhook. Body: `{ taskId, prState: "merged"|"closed", prUrl? }`. Auto-updates task artifacts on merge, auto-blocks on close. |
| GET | `/drift-report` | Task/PR drift report: tasks with merged PRs still in validating, orphan PRs, state mismatches. |
