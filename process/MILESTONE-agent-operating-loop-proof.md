# Milestone: Agent Operating Loop — First Full Proof

**Date:** 2026-03-11
**Proven by:** @link
**Validated by:** @coo

## What Was Proven

The Reflectt Host can manage a complete agent workflow as a coherent, durable, queryable unit — not chat glue.

## Run Reference

- **Run ID:** `arun-1773260540613-fxmyq6ehq`
- **Agent:** link
- **Objective:** Review and merge PR #836 (run card enrichment), hand off to sage for validation
- **Task:** `task-1773258268825-w2ykor9qz`

## Event Sequence

| # | Event Type | Key Payload |
|---|-----------|-------------|
| 1 | `run_created` | objective, teamId |
| 2 | `task_attached` | task_id, title |
| 3 | `review_requested` | action_required=approve, urgency=normal, owner=sage |
| 4 | `review_approved` | reviewer=sage, original_event_id, comment |
| 5 | `handed_off` | from=link, to=sage, rationale={choice, considered, constraint} |
| 6 | `completed` | summary, artifacts |

## APIs Exercised

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/agents/:agentId/runs` | Create run |
| PATCH | `/agents/:agentId/runs/:runId` | Update status (idle→working→completed) |
| POST | `/agents/:agentId/events` | Record events |
| GET | `/approvals/pending` | List actionable approvals |
| POST | `/approvals/:eventId/decide` | Submit approval decision |
| PUT | `/agents/:agentId/memories` | Write handoff context for next agent |
| GET | `/agents/:agentId/memories` | Second agent reads handoff (no chat history) |

## Second Agent Resumption

Sage retrieves handoff context via:
```
GET /agents/sage/memories?namespace=runs
```
Returns:
```
key=handoff-from-link
content=Run arun-1773260540613-fxmyq6ehq handed off: PR #836 run card enrichment approved and merged. Validate enriched run cards in dashboard.
```
Memory ID: `amem-1773261877388-koj2tb3wk`

No chat history required. No session context needed. Just the memory API.

## Durability Proof

- Events created before `launchctl kickstart -k` (server restart)
- All events survived restart and remained queryable
- Run status persisted through restart
- Approval routing correctly excluded resolved requests post-restart

## What Would Fail If One Primitive Were Missing

| Missing Primitive | What Breaks |
|------------------|-------------|
| agent_runs | No coherent unit — just scattered events with no parent |
| agent_events | No timeline — run exists but you can't see what happened |
| approval routing | No human-in-the-loop — agents can't request or receive decisions |
| agent_memories | No handoff — second agent must read chat history to understand context |
| boot context | Agent wakes up amnesic — doesn't know it has a pending run |
| SQLite persistence | Everything lost on restart — back to ephemeral chat |

## PRs That Built This

| PR | What It Added |
|----|--------------|
| #870 | agent_runs + agent_events (migration v21) |
| #871 | agent_memories (migration v22) |
| #874 | Boot context in heartbeat |
| #875 | Approval routing (pending + decide) |
| #836 | Run card enrichment (dashboard visibility) |

## Bottom Line

This is the first proof that Reflectt Host manages an agent operating loop — not just stores data. The loop is: create → attach → request → decide → handoff → complete → resume. Every step is durable, queryable, and independent of chat history.
