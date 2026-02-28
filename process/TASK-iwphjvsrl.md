# TASK-iwphjvsrl — Phantom task-comments + nonexistent task IDs

## Problem
We observed task-comments appearing attributed to **@link** that referenced **nonexistent task IDs** (404 when fetched). This creates noise, erodes trust, and wastes cycles triaging phantom work.

## Fix (PR)
PR: https://github.com/reflectt/reflectt-node/pull/483

### Changes
1) **Provenance support on comment ingestion**
- `POST /tasks/:id/comments` accepts optional `provenance` object.
- Comment rows now persist `provenance` (best-effort) so we can trace the emitter.

2) **Hard-reject nonexistent task IDs**
- If the *path param* task id is not resolvable:
  - return **404** (`TASK_NOT_FOUND`) or **409** (`AMBIGUOUS_TASK_ID`)
  - record a reject ledger row (no attribution to a human in chat)

3) **Hard-reject comments that reference nonexistent tasks in content**
- If comment content includes `task-...` references that don’t exist:
  - return **422** (`INVALID_TASK_REFS`)
  - do **not** store the comment
  - record a reject ledger row

4) **Reject ledger table**
- New SQLite table `task_comment_ingest_rejects` records:
  - attempted task param
  - resolved task id (if any)
  - author/content (best-effort)
  - reason (`task_not_found` | `invalid_task_refs`)
  - `provenance` blob
  - timestamp

## How to verify
### 1) Invalid task id in URL is rejected + ledgered

```bash
curl -i -X POST "http://127.0.0.1:4445/tasks/task-does-not-exist/comments" \
  -H 'content-type: application/json' \
  -d '{"author":"link","content":"hello","provenance":{"source_channel":"reflectt","original_message_id":"msg-123"}}'
```

Expect: 404/409 + `reject_id` in response.

### 2) Invalid referenced IDs in content are rejected (422)

```bash
REAL_TASK=<some real task id>
FAKE_TASK=task-0000000000000-fakefakefake

curl -i -X POST "http://127.0.0.1:4445/tasks/${REAL_TASK}/comments" \
  -H 'content-type: application/json' \
  -d '{"author":"link","content":"See also task-0000000000000-fakefakefake","provenance":{"integration":"chat-relay"}}'
```

Expect: 422 + `invalid_task_refs` includes the fake id; comment is not stored.

## Notes
- This is a behavior change: invalid referenced task IDs were previously warn-only; they are now a hard guardrail.
- Next: use reject ledger provenance to identify the top offending integration/emitter.
