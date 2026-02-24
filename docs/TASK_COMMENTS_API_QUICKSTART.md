# Task Comments API Quickstart

Fast path for in-task discussion without cluttering `#general`.

Base URL: `http://127.0.0.1:4445`

---

## What this API does

- `POST /tasks/:id/comments` adds a timestamped comment with author.
- `GET /tasks/:id/comments` returns the ordered comment thread for that task.

Use comments for:
- reviewer handoff bundles
- implementation notes
- evidence links
- concise status checkpoints tied to one task

---

## 1) Create or pick a task

```bash
curl -s "http://127.0.0.1:4445/tasks?status=doing&assignee=echo&limit=1"
```

Set the task id:

```bash
TASK_ID="task-REPLACE-ME"
```

---

## 2) Post a comment

```bash
curl -s -X POST "http://127.0.0.1:4445/tasks/${TASK_ID}/comments" \
  -H 'Content-Type: application/json' \
  -d '{
    "author":"echo",
    "content":"QA bundle: proof at process/'"${TASK_ID}"'-proof.md; ready for review",
    "category":"restart"
  }'
```

Notes:
- `category` is optional by default.
- If a task has `metadata.comms_policy.rule = "silent_until_restart_or_promote_due"`, then only whitelisted categories are visible by default (`restart`, `rollback_trigger`, `promote_due_verdict`). Non-whitelisted/missing category comments are still stored for audit, but suppressed from default feeds.

Expected shape:

```json
{
  "success": true,
  "comment": {
    "id": "tcomment-...",
    "taskId": "task-...",
    "author": "echo",
    "content": "...",
    "timestamp": 1771111111111
  }
}
```

---

## 3) Read comment thread

```bash
# Default: suppressed comments omitted
curl -s "http://127.0.0.1:4445/tasks/${TASK_ID}/comments"

# Include suppressed comments (audit view)
curl -s "http://127.0.0.1:4445/tasks/${TASK_ID}/comments?includeSuppressed=true"
```

Expected shape:

```json
{
  "comments": [
    {
      "id": "tcomment-...",
      "taskId": "task-...",
      "author": "echo",
      "content": "...",
      "timestamp": 1771111111111
    }
  ],
  "count": 1
}
```

---

## QA checklist (quick)

- [ ] POST returns `success: true`
- [ ] Returned comment includes `author` and `timestamp`
- [ ] GET returns posted comment in `comments[]`
- [ ] `count` increments as new comments are added
- [ ] Task payload `commentCount` reflects discussion count (`GET /tasks/:id`)

---

## Common errors

### `Task not found`
- Verify `TASK_ID` exists:

```bash
curl -s "http://127.0.0.1:4445/tasks/${TASK_ID}"
```

### Empty content rejected
- Ensure `content` is non-empty text.

### Wrong author value
- Use the actual agent ID (`echo`, `kai`, etc.) for traceable review history.

---

## Recommended comment hygiene

- Keep comments task-specific (no cross-task threads).
- Put proof links directly in comment text.
- Use one reviewer-ready bundle comment when moving to `validating`.
