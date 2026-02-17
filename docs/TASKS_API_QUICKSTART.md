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
| `validating` | `metadata.artifact_path` + `metadata.qa_bundle { lane, summary, pr_link, commit_shas[], changed_files[], artifact_links[], checks[], screenshot_proof[] }`. For code lanes, include `metadata.qa_bundle.review_packet { task_id, pr_url, commit, changed_files[], artifact_path, caveats? }`. For design/docs/non-code validations, set `metadata.qa_bundle.non_code=true` and review-packet path checks are skipped. |
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
    "content": "QA bundle: PR #123, tests pass, artifact=process/demo.md"
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
      "qa_bundle": {
        "lane": "docs",
        "summary": "Quickstart updated with validating QA bundle contract",
        "pr_link": "https://github.com/reflectt/reflectt-node/pull/123",
        "commit_shas": ["abc1234"],
        "changed_files": ["docs/TASKS_API_QUICKSTART.md"],
        "artifact_links": ["process/demo.md"],
        "checks": ["npm run -s check:route-docs-contract"],
        "screenshot_proof": ["docs/images/quickstart-validating.png"]
      }
    },
    "actor": "echo"
  }'
```

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
