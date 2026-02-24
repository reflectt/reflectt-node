# Tasks API Quickstart

Use this guide to move a task from `todo` → `doing` → `validating` → `done` with the current status contract.

Base URL:

```bash
BASE="http://localhost:4445"
```

## Status contract (current runtime)

| Status | Required fields |
|---|---|
| `todo` | `title`, `createdBy`, `assignee`, `reviewer`, `done_criteria[]`, `eta` |
| `doing` | `reviewer` + `metadata.eta` |
| `validating` | `metadata.artifact_path` + `metadata.review_handoff { task_id, artifact_path, test_proof, known_caveats, (pr_url+commit_sha unless doc_only/config_only/non_code) }`. **Code lanes** additionally require `metadata.qa_bundle.review_packet { task_id, pr_url, commit, changed_files[], artifact_path, caveats }` + bundle fields. **Non-code/doc-only/config-only** tasks may omit `metadata.qa_bundle` entirely (set `review_handoff.doc_only=true` or `review_handoff.non_code=true` or `review_handoff.config_only=true`). |
| `done` | No extra required field (recommended: reviewer sign-off comment) |

## 1) Create a task

```bash
curl -s -X POST "$BASE/tasks" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "demo: tasks api quickstart",
    "description": "Created from TASKS_API_QUICKSTART.md",
    "createdBy": "echo",
    "assignee": "echo",
    "reviewer": "pixel",
    "done_criteria": [
      "artifact attached",
      "reviewer sign-off"
    ],
    "priority": "P2",
    "eta": "30m"
  }'
```

Copy the returned task id into `TASK_ID`:

```bash
TASK_ID="task-REPLACE_ME"
```

## 2) Move to `doing`

> Note: docs/runtime drift currently exists for claim flow in some builds.
> If `POST /tasks/:id/claim` fails with `doing requires metadata.eta`, use PATCH below.

### Preferred (claim)

```bash
curl -s -X POST "$BASE/tasks/$TASK_ID/claim" \
  -H 'Content-Type: application/json' \
  -d '{"agent":"echo"}'
```

### Fallback (contract-safe patch)

```bash
curl -s -X PATCH "$BASE/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' \
  -d '{
    "assignee": "echo",
    "status": "doing",
    "metadata": {
      "eta": "30m",
      "first_artifact_eta": "5m"
    },
    "actor": "echo"
  }'
```

## 3) Add reviewer bundle comment

```bash
curl -s -X POST "$BASE/tasks/$TASK_ID/comments" \
  -H 'Content-Type: application/json' \
  -d '{
    "author": "echo",
    "content": "Review handoff: artifact=process/demo.md, doc_only=true, checks complete."
  }'
```

## 4) Move to `validating`

```bash
curl -s -X PATCH "$BASE/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "validating",
    "metadata": {
      "artifact_path": "process/demo.md",
      "review_handoff": {
        "task_id": "task-REPLACE_ME",
        "repo": "reflectt/reflectt-node",
        "artifact_path": "process/demo.md",
        "test_proof": "Docs-only proof complete (manual checklist).",
        "known_caveats": "Docs-only; no PR/commit required.",
        "doc_only": true
      }
    },
    "actor": "echo"
  }'
```

> Replace `task-REPLACE_ME` with your actual `$TASK_ID`.
> For code-lane tasks, include `metadata.qa_bundle` + `metadata.qa_bundle.review_packet` (PR/commit/files) as well.

## 5) Complete as `done`

```bash
curl -s -X PATCH "$BASE/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "done",
    "actor": "pixel"
  }'
```

## Quick verification checks

```bash
# task state
curl -s "$BASE/tasks/$TASK_ID"

# comments
curl -s "$BASE/tasks/$TASK_ID/comments"

# lifecycle instrumentation
curl -s "$BASE/tasks/instrumentation/lifecycle"
```

## Known issue note

- In some builds, `POST /tasks/:id/claim` may return a 500 with `Status contract: doing requires metadata.eta`.
- Workaround: use `PATCH /tasks/:id` with `status=doing` and `metadata.eta`.
- Follow-up fix should align runtime behavior and `/docs` claim contract description.
