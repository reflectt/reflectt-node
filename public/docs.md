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

## Preflight

| Method | Path | Description |
|--------|------|-------------|
| GET | `/preflight` | Run BYOH preflight checks (auth, network, runtime). Returns JSON with per-check pass/fail, remediation guidance, and overall readiness status. Query: `cloudUrl`, `port`, `skipNetwork` |
| GET | `/preflight/text` | Run preflight checks and return a plain-text formatted report for CLI/terminal display. Same query params as GET. |
| POST | `/preflight` | Run preflight checks with custom config. Body: `{ cloudUrl?, port?, skipNetwork?, joinToken?, apiKey?, userId? }`. When `userId` is provided, emits `host_preflight_passed` or `host_preflight_failed` activation funnel events for onboarding drop-off tracking. |

## Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | System health — task counts, chat stats, inbox stats |
| GET | `/team/health` | Team config linter status for `~/.reflectt/TEAM.md`, `TEAM-ROLES.yaml`, `TEAM-STANDARDS.md` (issues, role coverage, last check timestamp) |
| GET | `/health/team` | Team health metrics with compliance + `staleDoing` snapshot. Per-agent rows include `activeTaskTitle` and `activeTaskPrLink` when an agent has a doing task with PR evidence. Flagged agents also include `actionable_reason` (last comment age, last transition, last mention age, suggested action). |
| GET | `/health/agents` | Per-agent health summary (`last_seen`, `active_task`, `heartbeat_age_ms`, `last_shipped_at`, `stale_reason`, state) |
| GET | `/health/compliance` | Compliance check results |
| GET | `/health/backlog` | Backlog readiness health by lane (ready counts, floor compliance, breach status, blocked/todo/doing/validating rollups). |
| GET | `/health/system` | System info (uptime, memory, versions) |
| GET | `/health/build` | Build/runtime identity (version, git SHA, branch, build timestamp, PID, uptime) |
| GET | `/health/deploy` | Deploy attestation payload for dashboards (`version`, `gitSha`, `branch`, `buildTimestamp`, `startedAt`, `pid`) |
| GET | `/health/team/summary` | Compact team health summary |
| GET | `/health/team/history` | Historical team health data |
| GET | `/health/workflow` | Unified per-agent workflow state: doing-task age, last shipped timestamp, blocker flag, artifact path, and linked PR state |
| GET | `/health/reflection-pipeline` | Reflection→Insight→Promotion health signal. Returns recent reflection/insight/promotion counts, status (`healthy`\|`at_risk`\|`broken`), and alert timestamps. Triggers alert when reflections flow but insights remain zero past threshold. |
| GET | `/health/backlog` | Backlog readiness snapshot by lane/agent with ready-floor breach detection and stale-validating summary. |
| GET | `/health/mention-ack` | Mention-ack lifecycle metrics (pending, timeout, latency counters) |
| GET | `/health/mention-ack/recent` | Recent mention-ack entries for debugging. Query: `limit` (max 100) |
| GET | `/health/mention-ack/:agent` | Pending mention-ack entries for one agent |
| POST | `/health/mention-ack/check-timeouts` | Run timeout sweep and return timed-out mention entries |
| GET | `/health/idle-nudge/debug` | Idle-nudge watchdog debug state |
| POST | `/health/idle-nudge/tick` | Trigger idle-nudge evaluation |
| POST | `/health/cadence-watchdog/tick` | Trigger cadence watchdog |
| POST | `/health/mention-rescue/tick` | Trigger mention-rescue fallback |
| POST | `/health/working-contract/tick` | Evaluate working-contract enforcement: auto-requeue stale doing tasks (90m warning → 15m grace → auto todo) and fire alerts. |
| GET | `/health/working-contract/gate/:agent` | Dry-run claim gate check for an agent. Returns `{ allowed, reason }` — whether the agent can claim a new task given current WIP and contract status. |

### Team Pulse

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health/team/pulse` | Current team pulse snapshot: per-agent activity summary, team velocity, and health signals |
| GET | `/health/team/pulse/config` | Read team pulse broadcast configuration |
| GET | `/health/team/pulse/history` | Historical pulse snapshots. Query: `limit`, `since` |
| PATCH | `/health/team/pulse/config` | Update pulse config. Fields: `intervalMs`, `channel`, `enabled` |
| POST | `/health/team/pulse` | Trigger immediate team pulse broadcast |
| GET | `/health/team/doctor` | Run team doctor diagnostics: checks node, database, agents, gateway, model auth, chat activity. Returns overall status + fix instructions |
| POST | `/team/starter` | Scaffold a starter team with default agents (builder + ops). Idempotent: skips existing agent directories |

### Quiet hours behavior (watchdogs)

Watchdog endpoints currently execute whenever called (manual or scheduled). Quiet-hours suppression is not enforced by these endpoints at the API layer yet.

If your deployment needs quiet-hours behavior today, enforce it in scheduler/gateway policy (for example: only trigger watchdog ticks during allowed windows).

## Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks` | List tasks. Query: `status`, `assignee`, `agent`, `priority`, `limit`, `offset`, `q` (text search), `updatedSince`. Returns `{ tasks, total, offset, limit, hasMore }`. |
| GET | `/tasks/:id` | Get task by ID. Also accepts unambiguous ID prefixes. Ambiguous prefix returns `400` with full-ID suggestions. |
| GET | `/tasks/:id/artifacts` | Resolve all artifact references from task metadata. Returns accessibility status (file existence, URL validation), heartbeat status (last comment age, staleness). Heartbeat threshold: 30m for doing tasks. |
| GET | `/tasks/:id/history` | Status changelog for task lifecycle transitions. Returns `history[]` entries shaped as `{ status, changedBy, changedAt, metadata }` for each status transition. |
| GET | `/tasks/:id/comments` | List task discussion comments. Query: `includeSuppressed=true|1` to include suppressed (audit) comments. Returns `{ comments, count, includeSuppressed }` where each comment is `{ id, taskId, author, content, timestamp, category?, suppressed, suppressedReason?, suppressedRule? }`. |
| POST | `/tasks/:id/comments` | Add task comment. Body: `{ "author": "agent", "content": "text", "category"?: "restart|rollback_trigger|promote_due_verdict" }`. If task has `metadata.comms_policy.rule = silent_until_restart_or_promote_due`, missing/non-whitelisted categories are stored but suppressed from default feeds. Returns `{ success, comment }` (same fields as GET comments). |
| GET | `/tasks/:id/pr-review` | PR review quality panel data. Returns diff scope, CI checks, done criteria alignment. Requires PR URL in task metadata (`pr_url`, `qa_bundle.pr_link`, or in `artifacts`). |
| POST | `/tasks/:id/outcome` | Capture 48h checkpoint verdict for completed tasks. Body: `verdict` (`PASS`\|`NO-CHANGE`\|`REGRESSION`), optional `author`, `notes` |
| POST | `/tasks/:id/review-bundle` | Auto-build reviewer packet by resolving PR URL + CI + artifact evidence from task metadata. Returns normalized `verdict` (`pass`/`fail`) and reasons. Optional body: `author`, `strict` (default `true`, requires CI=`success`). |
| POST | `/tasks/:id/review` | Reviewer decision endpoint. Body: `{ "reviewer": "agent", "decision": "approve|reject", "comment": "..." }`. Only the assigned reviewer may submit. Updates task metadata with reviewer decision + approval flag. |
| POST | `/tasks` | Create task. Required: `title`, `createdBy`, `assignee`, `reviewer`, `done_criteria` (string[]), `eta`. Optional: `description`, `priority` (P0-P3), `status`, `tags`, `metadata`. **Reflection-origin invariant:** `metadata.source_reflection` or `metadata.source_insight` required (or `metadata.reflection_exempt=true` with `reflection_exempt_reason`). Status contract: `validating` also requires `metadata.artifact_path` under `process/`. |
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
| GET | `/tasks/heartbeat-status` | All doing tasks with stale comment activity (>30m). Returns `{ threshold, doingTaskCount, staleCount, staleTasks[] }`. Use for monitoring status heartbeat discipline compliance. |
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

### Done-gate: PR merge verification

When closing a code-lane task (`product`/`frontend`/`backend`/`infra` lane or `code` tag), the API verifies:

1. **`artifacts` required** — at least one proof link (`gate: artifacts`)
2. **PR URL required** — at least one GitHub PR URL in artifacts (`gate: pr_link`)
3. **PR must be merged** — linked PRs are checked via GitHub API; open PRs block closure (`gate: pr_not_merged`)
4. **Reviewer sign-off** — assigned reviewer must approve (`gate: reviewer_signoff`)

Bypass: set `metadata.pr_waiver=true` + `metadata.pr_waiver_reason` to skip PR gates (hotfixes).
Graceful degradation: if GitHub API is unavailable, the merge check is skipped (does not block).

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

### Noise Budget (control-plane rate limiting)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/chat/noise-budget` | Current budget snapshot: per-channel ratios, window stats, enforcement state |
| GET | `/chat/noise-budget/canary` | Canary rollback evaluation: ratio vs target, SLA miss delta, P95 response delta |
| GET | `/chat/noise-budget/suppression-log` | Audit trail of suppressed/digested messages |
| GET | `/chat/noise-budget/config` | Read current noise budget configuration |
| PATCH | `/chat/noise-budget/config` | Update config. Fields: `budgetPercent`, `dedupWindowMs`, `digestIntervalMs`, `channelBudgets` |
| POST | `/chat/noise-budget/activate` | Exit canary (log-only) mode and enable enforcement |
| POST | `/chat/noise-budget/flush-digest` | Force immediate digest flush |

Bypass: escalation, blocker, and critical-priority messages always pass through budget enforcement.
Budget enforcement requires minimum 10 messages in the rolling window before activating.

### Alert Integrity Guard (false-positive prevention)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/chat/alert-integrity` | Current alert integrity stats: total checked, blocked false-positives, pass-through count |
| GET | `/chat/alert-integrity/audit` | Audit log of preflight decisions. Query: `limit`, `since` |
| GET | `/chat/alert-integrity/config` | Read alert integrity guard configuration |
| GET | `/chat/alert-integrity/rollback` | Rollback evaluation: false-positive rate, missed true-positives, preflight latency p95 |
| PATCH | `/chat/alert-integrity/config` | Update config. Fields: `enabled`, `canaryMode`, `maxPreflightMs`, `reconcileFields` |
| POST | `/chat/alert-integrity/activate` | Exit canary (log-only) mode and enable enforcement |

Preflight checks reconcile live task state (status, assignee, reviewer, recent comment timestamp, queue state hash) before publishing SLA/requeue/stale alerts. Idempotent alert key: `task_id + alert_type + state_hash`.

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
| POST | `/feedback` | Submit user feedback. Body: `{ category: "bug"\|"feature"\|"general", message (10-1000 chars), email?, url?, siteToken, severity?, reporterType?, reporterAgent? }`. Rate limited 5/min/IP. |
| GET | `/feedback` | List feedback. Query: `status=new\|triaged\|archived\|all`, `category`, `severity`, `reporterType`, `sort=date\|votes\|severity`, `order`, `limit`, `offset`. |
| GET | `/feedback/:id` | Get single feedback record. |
| PATCH | `/feedback/:id` | Triage/update feedback metadata. Body: `{ status?, notes?, assignedTo? }`. |
| POST | `/feedback/:id/vote` | Upvote feedback. |
| GET | `/triage` | List untriaged feedback queue sorted by severity/date with suggested priorities. |
| POST | `/feedback/:id/triage` | Convert feedback into a task. Body: `{ triageAgent, priority?, assignee?, lane?, title? }`. |
| GET | `/widget/feedback.js` | Embeddable feedback widget (Shadow DOM, self-contained). Embed: `<script src="/widget/feedback.js" data-token="..." data-theme="auto">`. |
| GET | `/routing/log` | Recent routing decisions. Query: `?limit=50&since=timestamp&category=watchdog-alert&severity=warning`. |
| POST | `/routing/resolve` | Dry-run route resolution. Body: `{ from, content, severity?, category?, taskId?, mentions? }`. Returns where message would go. |
| POST | `/routing/overrides` | Create a routing override. Body: `CreateOverrideInput` with target, target_type, override config, TTL. Returns created override. |
| GET | `/routing/overrides` | List routing overrides. Query: `?target=agent&target_type=agent|role&status=active|expired&limit=N`. |
| GET | `/routing/overrides/:id` | Get a specific routing override by ID. |
| GET | `/routing/overrides/active/:target` | Find the currently active override for a target. Query: `?target_type=agent|role`. |
| POST | `/routing/overrides/tick` | Advance override lifecycle — expires stale overrides, applies TTL rules. |
| POST | `/tasks/:id/precheck` | Precheck task transition. Body: `{ targetStatus }`. Returns required fields, auto-defaults, and a PATCH template. |
| GET | `/health/watchdog/suppression` | Watchdog de-noise config: show all suppression rules, thresholds, and what activity types prevent re-firing. | Body: `{ agent, type, priority?, channel?, message? }`. Returns routing decision + reason. |
| GET | `/runtime/truth` | Canonical environment snapshot for operators: repo/branch/SHA, runtime host+port+PID+uptime, deploy drift, cloud registration/heartbeat, and `REFLECTT_HOME` path. |

## Reflections

| Method | Path | Description |
|--------|------|-------------|
| POST | `/reflections` | Create a structured reflection. Body: `{ pain, impact, evidence[] (array, min 1), went_well, suspected_why, proposed_fix, confidence (0-10), role_type, author }`. Optional: `severity` (low\|medium\|high\|critical), `task_id`, `tags[]`, `team_id`, `metadata {}`. Returns 400 with field-level errors on validation failure. |
| GET | `/reflections` | List reflections. Query: `author`, `role_type`, `severity`, `task_id`, `team_id`, `since`, `before`, `limit` (max 200), `offset`. |
| GET | `/reflections/:id` | Get single reflection by ID. |
| GET | `/reflections/stats` | Aggregate stats: total count, by role_type, by severity, average confidence. |
| GET | `/reflections/sla` | Reflection SLA status per agent: last reflection time, overdue hours, tasks done since last reflection. |
| POST | `/reflections/nudge/tick` | Manually trigger reflection nudge cycle (post-task + idle checks). |
| GET | `/reflections/schema` | Machine-readable field reference (required/optional fields, enums, ranges). |

## Insights (Clustering Engine)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/insights/ingest` | Ingest a reflection into clustering. Body: `{ reflection_id }`. Cluster key auto-derived from reflection tags/content. Promotion gate: 2 independent reflections (distinct authors) OR severity high/critical. 24h cooldown after promotion. |
| GET | `/insights` | List insights. Query: `status` (candidate\|promoted\|pending_triage\|task_created\|cooldown\|closed), `priority` (P0-P3), `workflow_stage`, `failure_family`, `impacted_unit`, `limit`, `offset`. Sorted by score desc. |
| GET | `/insights/bridge/stats` | Insight→Task bridge stats: auto-created count, triaged count, duplicates skipped, errors. |
| GET | `/insights/bridge/config` | Current bridge config including ownership guardrail settings. |
| PATCH | `/insights/bridge/config` | Update bridge config. Body: partial config object (e.g. `{ ownershipGuardrail: { enabled: false } }`). |
| GET | `/insights/:id/assignment-preview` | Dry-run ownership guardrail for an insight. Returns `{ decision: { assignee, reviewer, reason, guardrailApplied, soleAuthorFallback, candidatesConsidered, insightAuthors } }`. Query: `team_id`. |
| GET | `/insights/triage` | List insights in `pending_triage` status (medium/low severity awaiting review). Query: `limit`. |
| POST | `/insights/:id/triage` | Triage a pending insight. Body: `{ action: "approve"\|"dismiss", assignee? (required for approve), reviewer?, rationale?, priority?, triaged_by? }`. Approve creates a linked task; dismiss closes the insight. Records audit decision with reviewer + rationale. |
| GET | `/insights/triage/audit` | Triage decision audit trail (all insights). Returns timestamped decisions with reviewer, rationale, action, outcome. Query: `limit`. |
| GET | `/insights/:id/triage/audit` | Triage audit trail for a specific insight. Returns full lifecycle: entry → decision → outcome. |
| GET | `/insights/:id` | Get single insight by ID. |
| GET | `/insights/stats` | Aggregate stats: by status, priority, failure family. |
| POST | `/insights/tick-cooldowns` | Advance cooldown state machine: promoted past deadline → cooldown, expired cooldown → archived. |
| POST | `/insights/:id/promote` | Promote insight to board task. Body: `{ contract: { owner, reviewer, eta, acceptance_check, artifact_proof_requirement, next_checkpoint_eta }, promoted_by }`. Optional: `title`, `description`, `priority`, `team_id`. Returns task_id + audit entry. |
| GET | `/insights/:id/audit` | Promotion audit trail for an insight. |
| GET | `/insights/promotions` | List all promotion audit entries. Query: `limit`. |
| GET | `/insights/recurring/candidates` | List recurring task candidates from insights with persistent patterns. Auto-suggests owner/lane per failure family. Template-first (no auto task spam). |

## Scoring Engine Configuration

The insight scoring engine uses the following parameters (defined in `src/insights.ts`):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `PROMOTION_THRESHOLD` | `2` | Minimum independent reflections (distinct authors) required for automatic promotion. Severity high/critical bypasses this gate. |
| `COOLDOWN_MS` | `86400000` (24h) | Cooldown period after promotion before the insight can be re-promoted. |
| `HYSTERESIS_BUFFER` | `0.3` | Score buffer zone around priority thresholds to prevent flapping. A score must exceed `threshold + buffer` to upgrade priority, or drop below `threshold - buffer` to downgrade. If within the buffer zone, previous priority is retained. |
| `SCORING_ENGINE_VERSION` | `1.1.0` | Semver tag included in all scoring output for audit lineage. |

### Priority thresholds (with hysteresis)

| Priority | Score threshold | Upgrade requires | Downgrade requires |
|----------|----------------|------------------|--------------------|
| P0 | ≥ 9 | score ≥ 9.3 | score < 8.7 |
| P1 | ≥ 7 | score ≥ 7.3 | score < 6.7 |
| P2 | ≥ 4 | score ≥ 4.3 | score < 3.7 |
| P3 | < 4 | — | — |

### Audit fields in scoring output

Every scored insight includes these audit fields:

- **`dedupe_cluster_id`** — Cluster key for deduplication across reflections
- **`promotion_band`** — Current priority band (P0–P3) after hysteresis
- **`decision_trace`** — Top contributing factors to the score (severity, author count, recency, etc.)
- **`version`** — Scoring engine version for reproducibility
- **`hysteresis_applied`** — Whether the buffer zone retained a previous priority

## Lineage Timeline (Debug/Audit)

Traces the full reflection → insight → task chain for debugging and audit. Each insight forms a chain; anomalies (missing links, stale promotions) are flagged automatically.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/lineage` | List lineage entries (insight-centric chains). Each entry includes linked reflection, insight, task, promotion audit, timeline events, and anomaly flags. Query: `status` (insight status filter), `team_id`, `role_type`, `author`, `has_anomaly` (true\|false), `limit` (default 50, max 200), `offset`. Sorted by most recently updated. |
| GET | `/lineage/:id` | Get lineage chain by insight ID, reflection ID, or task ID. Resolves any ID type to its full chain. Returns 404 if no chain found. |
| GET | `/lineage/stats` | Lineage statistics: total chains, chains with tasks, chains with anomalies, anomaly type breakdown. |

**Anomaly types:** `missing_insight` (reflection not clustered), `missing_task` (task_id points to deleted task), `orphaned_insight` (insight with no reflections), `stale_promotion` (promoted >48h with no task), `missing_reflection` (reflection ID in insight but not in DB).

**Timeline events:** `reflection_created`, `insight_created`, `insight_promoted`, `task_created` — each with timestamp and actor.

## Intake Pipeline

| Method | Path | Description |
|--------|------|-------------|
| POST | `/intake` | Process a single reflection through the full intake pipeline (validate → create reflection → cluster into insight → auto-promote if gate met). Body: `{ reflection: { pain, impact, evidence[], went_well, suspected_why, proposed_fix, confidence, role_type, author }, auto_promote?: boolean, promotion_contract?: { owner, reviewer, eta, acceptance_checks[], artifact_proof_requirement, next_checkpoint_eta } }`. Returns pipeline result with reflection, insight, and optional promotion outcome. |
| POST | `/intake/batch` | Batch process multiple reflections through the intake pipeline. Body: `{ items: [{ reflection: {...}, auto_promote?: boolean, promotion_contract?: {...} }, ...] }`. Returns per-item results with summary counts (processed, promoted, errors). |
| GET | `/intake/stats` | Pipeline statistics: total processed, auto-promoted count, error count, last run timestamp. |
| POST | `/intake/maintenance` | Run pipeline maintenance: tick cooldowns, clean stale state, advance insight state machine. Returns maintenance summary. |

## Continuity Loop

Autonomous work-continuity system. Monitors agent queue floors and auto-replenishes by promoting qualified insights into tasks. Falls back to reflection nudges when no promotable insights exist.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/continuity/stats` | Loop statistics: cycles run, insights promoted, reflection nudges fired, no-candidate cycles, last run timestamp. |
| GET | `/continuity/audit` | Persistent audit trail of all continuity actions. Query: `agent`, `limit`, `since` (epoch ms). Returns timestamped actions with kind, detail, linked insight/task IDs. |
| POST | `/continuity/tick` | Manually trigger one continuity cycle. Returns actions taken, agents checked, and replenishment count. Normally runs automatically via board health worker. |

### Shipped Heartbeat

| Method | Path | Description |
|--------|------|-------------|
| GET | `/shipped-heartbeat/stats` | Shipped-artifact heartbeat stats: messages sent, errors, last heartbeat timestamp. |

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
| GET | `/pr-automerge/status` | PR auto-merge attempt log: recent merge/close attempts with summary counts (attempted, success, failed, skipped, auto-close, close-gate-fail). |
| GET | `/drift-report` | Task/PR drift report: tasks with merged PRs still in validating, orphan PRs, state mismatches. |
| POST | `/activation/event` | Record activation funnel event. Body: `{ type, userId, metadata? }`. Events: signup_completed, host_preflight_passed, host_preflight_failed, workspace_ready, first_task_started, first_task_completed, first_team_message_sent, day2_return_action. |
| GET | `/activation/funnel` | Get funnel state. Query: `?userId=...` for single user, no params for aggregate summary. |
| GET | `/activation/dashboard` | Full onboarding telemetry dashboard: conversion funnel, failure distribution, weekly trends. Query: `?weeks=12`. |
| GET | `/activation/funnel/conversions` | Step-by-step conversion rates with per-step reach count, conversion rate, and median step timing. |
| GET | `/activation/funnel/failures` | Failure-reason distribution per step. Shows where users drop off and why (from event metadata). |
| GET | `/activation/funnel/weekly` | Weekly trend snapshots for planning. Query: `?weeks=12`. Exportable JSON with per-week step counts, new users, completion rate. |
| GET | `/audit/reviews` | Audit ledger for review-field mutations: actor trace, before/after diffs, timestamps. |
| GET | `/audit/mutation-alerts` | Suspicious mutation alert status and history. |
| GET | `/escalations` | List active escalations. |
| GET | `/escalations/:id` | Get escalation details by ID. |
| GET | `/feedback/:feedbackId/escalation` | Get escalation linked to feedback item. |
| GET | `/feedback/:id/sla` | SLA status for a feedback/support item. |
| GET | `/support/tiers` | Support tier SLA policy definitions. |
| POST | `/escalations` | Create a new escalation. |
| POST | `/escalations/:id/ack` | Acknowledge an escalation. |
| POST | `/escalations/:id/resolve` | Resolve an escalation. |
| POST | `/escalations/tick` | Trigger escalation timer tick (cron/manual). |
| POST | `/feedback/:id/respond` | Respond to a feedback/support item. |

## Reflection Automation

Team-wide nudging and SLA tracking for reflection cadence.

### Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/reflections/sla` | Reflection SLA status for all tracked agents. |
| POST | `/reflections/nudge/tick` | Tick nudge engine: fire pending post-task and idle nudges. |

### How It Works

1. **Post-task nudges**: When a task moves to `done` or `blocked`, the assignee is queued for a reflection nudge (configurable delay, default 5min).
2. **Idle nudges**: Agents who haven't submitted a reflection within their cadence interval (default: 8h for humans, 2h for agents) receive a reminder.
3. **Never-reflected agents**: New agents are auto-seeded into tracking on first discovery. Once seeded long enough (≥ cadence interval), they receive their first nudge. Controlled by `nudgeNeverReflected` (default: true).
4. **SLA breach**: Agents overdue beyond 1.5× their cadence interval are marked as `overdue`.
5. **Cooldowns**: Nudges are throttled per-agent (default: 60min between nudges).
6. **Tracking resets**: Submitting a reflection via `POST /reflections` resets the agent's tasks-done counter and last-reflection timestamp.
7. **Agent filtering**: Test/system agents (names matching `test-*`, `proof-*`, `lane-*`, `unassigned`, `system`, `bot`) are auto-excluded from SLA reporting and nudges. Additional exclusions via `excludeAgents` config.
8. **SLA agent discovery**: Agents are discovered from both active tasks (doing/todo/validating) AND the tracking table (agents who have reflected before). This ensures agents who go idle aren't silently dropped from SLA tracking.

### SLA Statuses

- `healthy`: Reflected within cadence interval
- `due`: Past cadence interval but within breach threshold
- `overdue`: Beyond breach threshold (1.5× cadence)

### Configuration

Set via `reflectionNudge` in policy config:

```json
{
  "reflectionNudge": {
    "enabled": true,
    "postTaskDelayMin": 5,
    "idleReflectionHours": 8,
    "cooldownMin": 60,
    "agents": [],
    "channel": "general",
    "roleCadenceHours": { "link": 4, "sage": 8 },
    "excludeAgents": [],
    "nudgeNeverReflected": true
  }
}
```

## Usage Tracking + Cost Guardrails

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/usage/report` | Record model usage event. Body: `{ agent, model, provider?, input_tokens, output_tokens, estimated_cost_usd?, category?, task_id?, team_id? }`. Auto-estimates cost if not provided. |
| POST | `/usage/report/batch` | Record batch of usage events. Body: `{ events: [...] }`. |
| GET | `/usage/summary` | Aggregated usage totals. Query: `since`, `until`, `agent`, `team_id`. |
| GET | `/usage/by-agent` | Per-agent cost breakdown. Query: `since`, `until`. |
| GET | `/usage/by-model` | Per-model cost breakdown. Query: `since`, `until`. |
| GET | `/usage/by-task` | Per-task cost attribution. Query: `since`, `until`, `limit`. |
| GET | `/usage/estimate` | Dry-run cost estimate (no storage). Query: `model`, `input_tokens`, `output_tokens`. |
| GET | `/usage/caps` | List active spend caps with current utilization status. |
| POST | `/usage/caps` | Create spend cap. Body: `{ scope: "global"\|"agent"\|"team", scope_id?, period: "daily"\|"weekly"\|"monthly", limit_usd, action: "warn"\|"throttle"\|"block" }`. |
| DELETE | `/usage/caps/:id` | Delete a spend cap. |
| GET | `/usage/routing-suggestions` | Smart routing savings suggestions (which low-stakes categories could use cheaper models). Query: `since`. |

### Model Pricing (built-in estimates, per 1M tokens)
| Model | Input | Output |
|-------|-------|--------|
| claude-opus-4-6 | $15.00 | $75.00 |
| claude-sonnet-4-6 | $3.00 | $15.00 |
| gpt-5.3 / gpt-5.3-codex | $2.00 | $8.00 |
| gpt-4o-mini | $0.15 | $0.60 |

### Spend Cap Events
- `usage:cap_warning` — emitted when spend reaches 80% of cap limit
- `usage:cap_breached` — emitted when spend exceeds cap limit

## Insight Reconciliation (Orphan Detection)

Ensures promoted insights always have task linkage. Detects and fixes orphaned insights.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/insights/orphans` | List promoted/task_created insights with no `task_id`. Returns `orphans[]` with id, title, status, score, priority, authors. |
| POST | `/insights/reconcile` | Scan orphaned insights and create tasks for each. Query: `dry_run=true` for preview. Returns scanned/created/skipped counts + details per insight. |

## Alert-Integrity Guard (P0-2)

Preflight reconciliation for system alerts — verifies live state before publishing to prevent stale/false-positive alerts.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/chat/alert-integrity` | Current guard snapshot: canary mode, total checked/rejected/passed, false-positive rate, rejection breakdown. |
| GET | `/chat/alert-integrity/audit` | Rejection audit log. Query: `limit` (default 50), `since` (timestamp). Returns rejected alerts with reason + state diff. |
| GET | `/chat/alert-integrity/config` | Read current guard config (enabled, canaryMode, reconcile checks, staleness thresholds). |
| PATCH | `/chat/alert-integrity/config` | Update guard config. Body: partial config object. |
| POST | `/chat/alert-integrity/activate` | Exit canary mode — start rejecting stale alerts (instead of log-only). |
| GET | `/chat/alert-integrity/rollback` | Rollback evaluation metrics: false-positive rate, critical misses, whether rollback trigger is tripped. |
