# Task: Since-Last-Seen Change Feed
**ID**: task-1771219268654-jhvubr179
**Branch**: link/task-jhvubr179
**Assignee**: link
**Reviewer**: harmony

## Summary
Unified agent change feed so agents can catch up after deep work without reading all of #general. Returns a single timeline of task changes, comments, mentions, PRs, deploys — filtered by relevance to the requesting agent.

## Changes
- **New**: `src/changeFeed.ts` — buildAgentFeed() function
  - Collects from: task history events, task comments, chat mentions, shipping channel PR/deploy signals
  - 11 event kinds: task_created, task_status_changed, task_assigned, task_commented, task_completed, pr_merged, mention, review_requested, deploy, blocker, digest
  - Filters by relevance (assignee, reviewer, mentioned), supports global events
  - Deduplication, kind filtering, limit/pagination
- **Modified**: `src/server.ts` — GET `/feed/:agent` endpoint
- **Modified**: `tests/modules.test.ts` — 6 new tests (191 total, all pass)
- **Modified**: `public/docs.md` — 1 new route entry (174/174 contract)

## REST Endpoint
| Method | Path | Description |
|--------|------|-------------|
| GET | `/feed/:agent?since=ts` | Unified change feed. Query: since (required), limit, kinds, includeGlobal |

## Done Criteria Mapping
- ✅ GET /feed/:agent?since=timestamp returns relevant changes
- ✅ Covers task state changes, PR merges, deploys, reviewer comments
- ✅ Agents can catch up after deep work without reading all of general

## Test Proof
- 191 tests pass (up from 185), 1 skipped (pre-existing)
- Route-docs contract: 174/174
