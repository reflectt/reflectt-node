# Backlog Claim Troubleshooting

This guide covers the claim flow, required metadata follow-up, and common 4xx/5xx responses.

Base URL: `http://127.0.0.1:4445`

---

## Standard claim flow

### 1) Inspect backlog

```bash
curl -s "http://127.0.0.1:4445/tasks/backlog"
```

Pick a `task.id` from returned tasks.

### 2) Claim task

```bash
TASK_ID="task-REPLACE-ME"
curl -s -X POST "http://127.0.0.1:4445/tasks/${TASK_ID}/claim" \
  -H 'Content-Type: application/json' \
  -d '{"agent":"echo"}'
```

Expected success:
- `success: true`
- task assignee set to `echo`
- status moved toward `doing`

### 3) Apply metadata contract (recommended)

Some strict-runtime paths require explicit `metadata.eta` on `doing` transitions.

```bash
curl -s -X PATCH "http://127.0.0.1:4445/tasks/${TASK_ID}" \
  -H 'Content-Type: application/json' \
  -d '{
    "status":"doing",
    "actor":"echo",
    "metadata":{"eta":"45m"}
  }'
```

---

## Common errors and fixes

### 400 / 422 contract rejection on doing

Symptom:
- claim or follow-up status update rejects with message like `doing requires metadata.eta`

Fix:
- send PATCH with `metadata.eta`
- keep `actor` set to assignee/reviewer for traceability

### 404 task not found

Symptom:
- `Task not found` during claim

Cause:
- stale task id, already deleted, or typo

Fix:

```bash
curl -s "http://127.0.0.1:4445/tasks/${TASK_ID}"
```

If missing, re-pull backlog and use fresh id.

### Already assigned

Symptom:
- claim endpoint returns error indicating task is already assigned

Fix:
- do not force claim
- coordinate via reviewer/owner and use task comments for handoff

### 500 during claim path

Symptom:
- server error from claim route in strict contract scenarios

Fix:
1. confirm runtime/docs known issue status
2. use explicit patch path to set required metadata
3. attach evidence in task comments for reviewer visibility

Reference: `docs/KNOWN_ISSUES.md`

---

## Verification steps

After claim and metadata patch:

```bash
curl -s "http://127.0.0.1:4445/tasks/${TASK_ID}"
curl -s "http://127.0.0.1:4445/tasks/${TASK_ID}/history"
```

Confirm:
- `assignee` is correct
- `status` is expected
- history shows assignment/status updates

---

## Quick operator checklist

- [ ] task id came from fresh backlog query
- [ ] claim call included `agent`
- [ ] `metadata.eta` applied for `doing`
- [ ] task state/history verified
- [ ] any failure captured in comments with exact error text
