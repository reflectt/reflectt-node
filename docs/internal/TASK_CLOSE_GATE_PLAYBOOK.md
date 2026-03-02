# Task-Close Gate Playbook

This playbook explains how to close tasks safely under the task-close gate.

Close gate enforces two required fields when setting `status=done`:
- `metadata.artifacts` (array of proof links)
- `metadata.reviewer_approved` (`true`)

If either is missing, close should fail.

---

## Why this gate exists

Without close-gate metadata, tasks can be marked done without evidence.

This gate ensures every closed task includes:
1. proof artifacts
2. explicit reviewer signoff

---

## Required close payload

```json
{
  "status": "done",
  "actor": "echo",
  "metadata": {
    "artifact_path": "process/task-proof.md",
    "artifacts": [
      "https://github.com/reflectt/reflectt-node/pull/123",
      "process/task-proof.md"
    ],
    "reviewer_approved": true,
    "eta": "completed"
  }
}
```

---

## PASS example (expected success)

```bash
curl -s -X PATCH "http://127.0.0.1:4445/tasks/TASK_ID" \
  -H 'Content-Type: application/json' \
  -d '{
    "status":"done",
    "actor":"echo",
    "metadata":{
      "artifact_path":"process/TASK-proof.md",
      "artifacts":["https://github.com/reflectt/reflectt-node/pull/123","process/TASK-proof.md"],
      "reviewer_approved":true,
      "eta":"completed"
    }
  }'
```

Expected result:
- `success: true`
- task transitions to `done`

---

## FAIL examples (expected rejection)

### FAIL 1 — missing `metadata.artifacts`

```bash
curl -s -X PATCH "http://127.0.0.1:4445/tasks/TASK_ID" \
  -H 'Content-Type: application/json' \
  -d '{
    "status":"done",
    "actor":"echo",
    "metadata":{
      "artifact_path":"process/TASK-proof.md",
      "reviewer_approved":true
    }
  }'
```

Expected rejection:
- `success: false`
- gate error/hint about `metadata.artifacts`

### FAIL 2 — missing `metadata.reviewer_approved`

```bash
curl -s -X PATCH "http://127.0.0.1:4445/tasks/TASK_ID" \
  -H 'Content-Type: application/json' \
  -d '{
    "status":"done",
    "actor":"echo",
    "metadata":{
      "artifact_path":"process/TASK-proof.md",
      "artifacts":["https://github.com/reflectt/reflectt-node/pull/123"]
    }
  }'
```

Expected rejection:
- `success: false`
- gate error/hint about reviewer approval

### FAIL 3 — reviewer exists but not approved

```bash
curl -s -X PATCH "http://127.0.0.1:4445/tasks/TASK_ID" \
  -H 'Content-Type: application/json' \
  -d '{
    "status":"done",
    "actor":"echo",
    "metadata":{
      "artifact_path":"process/TASK-proof.md",
      "artifacts":["https://github.com/reflectt/reflectt-node/pull/123"],
      "reviewer_approved":false
    }
  }'
```

Expected rejection.

---

## Reviewer workflow before close

1. Reviewer posts explicit PASS/FAIL comment.
2. Assignee updates metadata with artifact list.
3. Assignee sets `reviewer_approved=true` only after PASS.
4. Close with one final PATCH to `done`.

---

## Quick operator checklist

- [ ] PR link included in `artifacts`
- [ ] proof artifact path included
- [ ] reviewer signoff present
- [ ] `reviewer_approved=true`
- [ ] close patch succeeds with `success: true`
