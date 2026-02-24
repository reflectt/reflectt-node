# QA Bundle: Enforce comms_policy on task comments

**Task:** task-1771926708152-gcfgh6s14
**PR:** https://github.com/reflectt/reflectt-node/pull/319
**Commit:** 5416e33
**Branch:** link/task-gcfgh6s14
**Reviewer:** kai

## Goal
When a task opts into strict comms control via:

```json
{"comms_policy":{"rule":"silent_until_restart_or_promote_due"}}
```

…then comments must be categorized; only whitelisted categories are visible by default. Non-whitelisted comments are still stored for audit, but suppressed from default comment feeds.

## Behavior
- If `metadata.comms_policy.rule === "silent_until_restart_or_promote_due"`:
  - Determine category from request body `category` (preferred), else attempt to parse from content prefix.
  - Whitelist: `restart | rollback_trigger | promote_due_verdict`
  - Missing or non-whitelisted category → `suppressed=true` + `suppressedReason` set.
- Default comment feeds exclude suppressed comments.
- Suppressed comments are retrievable via `GET /tasks/:id/comments?includeSuppressed=true|1`.
- Suppressed comments do not relay to the `task-comments` chat channel.
- Activity signal (staleness) ignores suppressed comments.

## Implementation Notes
- `task_comments` now stores:
  - `category` (TEXT)
  - `suppressed` (INTEGER, default 0)
  - `suppressed_reason` (TEXT)
  - `suppressed_rule` (TEXT)
- Migration v13 adds the columns and indexes safely.

## Changed Files
- `src/db.ts`
- `src/types.ts`
- `src/tasks.ts`
- `src/server.ts`
- `src/activity-signal.ts`
- `src/working-contract.ts`
- `src/reflections.ts`
- `tests/comms-policy-comments.test.ts`
- `docs/TASK_COMMENTS_API_QUICKSTART.md`
- `public/docs.md`

## Test Proof
- `npm test --silent`
- Result: **930 passing**, 1 skipped (existing)
- New test coverage: `tests/comms-policy-comments.test.ts`

## Caveats
- Only the `silent_until_restart_or_promote_due` rule is implemented for now.
- `comment_count` remains a raw count of all stored comments (including suppressed), while default feeds exclude suppressed.
