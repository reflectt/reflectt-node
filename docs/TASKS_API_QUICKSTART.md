# Tasks API Quickstart (claim → doing → validating → done)

This guide shows one end-to-end task lifecycle using copy/paste `curl` commands, including required status-contract metadata.

Base URL used below: `http://127.0.0.1:4445`

---

## Status-contract requirements

| Status | Required fields |
|---|---|
| `todo` | normal create fields (`title`, `assignee`, `reviewer`, `done_criteria`, `eta`, `createdBy`) |
| `doing` | reviewer must exist + `metadata.eta` required |
| `validating` | `metadata.artifact_path` required |
| `done` | `metadata.artifacts` (array) + `metadata.reviewer_approved: true` |

---

## 1) Create a task (todo)

```bash
curl -s -X POST http://127.0.0.1:4445/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "title":"quickstart lifecycle demo",
    "description":"verify claim/doing/validating flow",
    "status":"todo",
    "assignee":"echo",
    "reviewer":"kai",
    "done_criteria":["lifecycle exercised"],
    "eta":"30m",
    "createdBy":"echo",
    "priority":"P2"
  }'
```

Copy the returned `task.id` into `TASK_ID`.

```bash
TASK_ID="task-REPLACE-ME"
```

---

## 2) Claim (self-serve path)

```bash
curl -s -X POST "http://127.0.0.1:4445/tasks/${TASK_ID}/claim" \
  -H 'Content-Type: application/json' \
  -d '{"agent":"echo"}'
```

If your runtime enforces strict `doing` metadata, follow up immediately with a PATCH that sets `metadata.eta`:

```bash
curl -s -X PATCH "http://127.0.0.1:4445/tasks/${TASK_ID}" \
  -H 'Content-Type: application/json' \
  -d '{
    "status":"doing",
    "actor":"echo",
    "metadata":{
      "eta":"30m"
    }
  }'
```

---

## 3) Move to validating (artifact required)

```bash
curl -s -X PATCH "http://127.0.0.1:4445/tasks/${TASK_ID}" \
  -H 'Content-Type: application/json' \
  -d '{
    "status":"validating",
    "actor":"echo",
    "metadata":{
      "eta":"30m",
      "artifact_path":"process/'"${TASK_ID}"'-proof.md"
    }
  }'
```

---

## 4) Add reviewer-facing comment bundle

```bash
curl -s -X POST "http://127.0.0.1:4445/tasks/${TASK_ID}/comments" \
  -H 'Content-Type: application/json' \
  -d '{
    "author":"echo",
    "content":"QA bundle: proof in process/'"${TASK_ID}"'-proof.md; ready for review"
  }'
```

---

## 5) Close to done (requires artifacts + reviewer approval)

```bash
curl -s -X PATCH "http://127.0.0.1:4445/tasks/${TASK_ID}" \
  -H 'Content-Type: application/json' \
  -d '{
    "status":"done",
    "actor":"echo",
    "metadata":{
      "artifact_path":"process/'"${TASK_ID}"'-proof.md",
      "artifacts":[
        "process/'"${TASK_ID}"'-proof.md",
        "https://github.com/reflectt/reflectt-node/pull/REPLACE"
      ],
      "reviewer_approved":true,
      "eta":"completed"
    }
  }'
```

---

## Useful checks

```bash
# task details (includes commentCount)
curl -s "http://127.0.0.1:4445/tasks/${TASK_ID}"

# comments
curl -s "http://127.0.0.1:4445/tasks/${TASK_ID}/comments"

# history
curl -s "http://127.0.0.1:4445/tasks/${TASK_ID}/history"
```
