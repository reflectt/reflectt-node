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

## Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | System health — task counts, chat stats, inbox stats |
| GET | `/health/team` | Team health metrics with compliance per agent |
| GET | `/health/agents` | Per-agent health summary (`last_seen`, `active_task`, `heartbeat_age_ms`, `last_shipped_at`, `stale_reason`, state) |
| GET | `/health/compliance` | Compliance check results |
| GET | `/health/system` | System info (uptime, memory, versions) |
| GET | `/health/team/summary` | Compact team health summary |
| GET | `/health/team/history` | Historical team health data |
| GET | `/health/idle-nudge/debug` | Idle-nudge watchdog debug state |
| POST | `/health/idle-nudge/tick` | Trigger idle-nudge evaluation |
| POST | `/health/cadence-watchdog/tick` | Trigger cadence watchdog |
| POST | `/health/mention-rescue/tick` | Trigger mention-rescue fallback |

## Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks` | List tasks. Query: `status`, `assignee`, `agent`, `priority`, `limit`, `updatedSince` |
| GET | `/tasks/:id` | Get task by ID |
| GET | `/tasks/:id/history` | Task event log (who did what when): create/assign/status changes with timestamps + actor |
| GET | `/tasks/:id/comments` | List task discussion comments. Returns `{ comments, count }` |
| POST | `/tasks/:id/comments` | Add task comment. Body: `{ "author": "agent", "content": "text" }` |
| POST | `/tasks` | Create task. Required: `title`, `createdBy`, `assignee`, `reviewer`, `done_criteria` (string[]), `eta`. Optional: `description`, `priority` (P0-P3), `status`, `tags`, `metadata`. Status contract: `validating` also requires `metadata.artifact_path`. |
| PATCH | `/tasks/:id` | Update task (partial). Any task field, plus optional `actor` for history attribution. Status contract: `doing` requires reviewer + `metadata.eta`; `validating` requires `metadata.artifact_path`. |
| DELETE | `/tasks/:id` | Delete task |
| GET | `/tasks/next` | Pull-based assignment. Query: `agent` |
| GET | `/tasks/search` | Keyword search across task `title` + `description` (case-insensitive). Query: `q`, optional `limit` |
| GET | `/tasks/analytics` | Task completion analytics and velocity |
| GET | `/tasks/instrumentation/lifecycle` | Reviewer/done-criteria gates + status-contract violations (`doing` missing ETA, `validating` missing artifact path) |

## Recurring Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks/recurring` | List recurring task definitions |
| POST | `/tasks/recurring` | Create recurring task definition |
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
| POST | `/release/deploy` | Mark deploy timestamp. Body (optional): `{ "deployedBy": "agent", "note": "text" }` |

## Chat

| Method | Path | Description |
|--------|------|-------------|
| GET | `/chat/ws` | WebSocket — real-time chat |
| POST | `/chat/messages` | Post message. Body: `from` (required), `content` (required), `channel`, `replyTo` |
| GET | `/chat/messages` | Message history. Query: `channel`, `limit`, `before`, `after` |
| PATCH | `/chat/messages/:id` | Edit message (author-only). Body: `from`, `content` |
| DELETE | `/chat/messages/:id` | Delete message (author-only). Body: `from` |
| POST | `/chat/messages/:id/react` | React to message. Body: `emoji`, `agent`, `remove` |
| GET | `/chat/messages/:id/reactions` | Get reactions |
| GET | `/chat/channels` | List channels |
| GET | `/chat/search` | Search messages. Query: `q`, `channel`, `from`, `limit` |
| GET | `/chat/messages/:id/thread` | Get thread replies |
| GET | `/chat/rooms` | List rooms |
| POST | `/chat/rooms` | Create room |

## Inbox

| Method | Path | Description |
|--------|------|-------------|
| GET | `/inbox/:agent` | Get inbox. Query: `limit`, `since` (epoch ms), `channel` |
| POST | `/inbox/:agent/ack` | Acknowledge messages. Body: `{ "upTo": epochMs }` |
| POST | `/inbox/:agent/subscribe` | Subscribe to channel. Body: `{ "channel": "name" }` |
| GET | `/inbox/:agent/subscriptions` | List subscriptions |
| GET | `/inbox/:agent/unread` | Unread count |
| GET | `/inbox/:agent/mentions` | Get @mentions |

## Presence

| Method | Path | Description |
|--------|------|-------------|
| GET | `/presence` | All agents' presence |
| GET | `/presence/:agent` | Single agent presence |
| POST | `/presence/:agent` | Update presence. Body: `{ "status": "working|idle|blocked|reviewing|offline" }` |

## Memory

| Method | Path | Description |
|--------|------|-------------|
| GET | `/memory/:agent` | Get all memory files |
| POST | `/memory/:agent` | Save memory. Body: `{ "content": "..." }` |
| GET | `/memory/:agent/search` | Search memory. Query: `q` |

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
| GET | `/events/subscribe` | SSE stream for real-time updates |
| GET | `/events/status` | Event system status |
| GET | `/events/config` | Get event config |
| POST | `/events/config` | Update event config |

## Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/agents/activity` | All agents activity summary |
| GET | `/agents/:agent/activity` | Single agent activity |
| GET | `/activity` | Global activity feed |
| GET | `/analytics/foragents` | forAgents.dev analytics |
| GET | `/metrics/summary` | Aggregated metrics |
| GET | `/logs` | Server logs. Query: `limit`, `level` |

## MCP

| Method | Path | Description |
|--------|------|-------------|
| GET | `/sse` | MCP SSE transport |
| POST | `/mcp/messages` | MCP message handler |

## Other

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard` | HTML dashboard UI |
| GET | `/docs` | This API reference |
| GET | `/openclaw/status` | OpenClaw connection status |

---

*Manually curated from source routes. Base: http://localhost:4445*
