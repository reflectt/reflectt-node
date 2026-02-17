# Task: Channel Hygiene
**ID**: task-1771255534920-ymnyma7oz
**Branch**: link/task-ymnyma7oz
**Assignee**: link
**Reviewer**: kai

## Summary
Message routing layer that moves routine ops noise out of #general. Watchdog alerts, status updates, and digests now route to #ops or task comments. #general reserved for decisions, escalations, blockers, and ship notices.

## Changes
- **New**: `src/messageRouter.ts` — Message routing engine
  - Routes by severity (critical → general) and category (watchdog → ops, digest → ops, etc.)
  - Task-scoped messages auto-added as task comments
  - Routing decision log for observability
  - Stats endpoint showing channel distribution
  - Dry-run resolve endpoint for previewing routes
- **New**: `ops` channel added to `src/channels.ts`
- **Modified**: `src/health.ts` — All 4 `chatManager.sendMessage` calls → `routeMessage`
  - Trio silence → escalation (stays general)
  - Stale working → watchdog-alert (→ ops + task comment)
  - Mention rescue → mention-rescue (stays general)
  - Idle nudge → watchdog-alert (warn → ops, escalate → general)
- **Modified**: `src/boardHealthWorker.ts` — All 3 `chatManager.sendMessage` calls → `routeMessage`
  - Auto-block notification → watchdog-alert (→ ops + task comment)
  - Digest → digest (→ configured channel)
  - Rollback notification → system-info (→ ops)
- **Modified**: `src/server.ts` — 3 routing endpoints
- **Modified**: `tests/modules.test.ts` — 10 new tests (206 total)
- **Modified**: `public/docs.md` — 3 new route entries (180/180)

## Done Criteria Mapping
- ✅ Routine status updates auto-route to task comments by default
- ✅ #general reserved for decisions, blockers, ship notices with reviewer tags
- ✅ Watchdog enforcement output moves to #ops or task comments
- ✅ System notifications filterable by severity (routing log supports severity filter)
