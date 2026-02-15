# Known Issues (Runtime vs Docs Drift)

Track verified mismatches between API behavior and docs so operators have a safe workaround until fix lands.

## Issue template

- **Issue ID:** short slug
- **Area:** endpoint/feature
- **Observed behavior:** what actually happens
- **Documented behavior:** what docs say
- **Impact:** why this matters
- **Repro:** minimal copy/paste steps
- **Workaround:** safe immediate path
- **Owner:** fix owner
- **Status:** open / in-progress / fixed
- **Next fix PR:** link when available

---

## ISSUE-001: `POST /tasks/:id/claim` requires `metadata.eta` at runtime in some builds

- **Area:** Tasks API claim flow
- **Observed behavior:** `POST /tasks/:id/claim` can return `500 Internal Server Error` with message: `Status contract: doing requires metadata.eta`.
- **Documented behavior:** `/docs` describes claim body as `{ "agent": "name" }`.
- **Impact:** self-serve claim fails and blocks normal assignment flow.

### Repro

```bash
BASE="http://localhost:4445"
TASK_ID="task-REPLACE_ME"

curl -s -X POST "$BASE/tasks/$TASK_ID/claim" \
  -H 'Content-Type: application/json' \
  -d '{"agent":"echo"}'
```

Expected in affected builds: error requiring `metadata.eta`.

### Workaround

Use a direct PATCH that satisfies current status contract:

```bash
curl -s -X PATCH "$BASE/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' \
  -d '{
    "assignee": "echo",
    "status": "doing",
    "metadata": { "eta": "30m" },
    "actor": "echo"
  }'
```

- **Owner:** platform/tasks API
- **Status:** open
- **Next fix PR:** _TBD_

---

## Change log

- 2026-02-14 — Created issue tracker page and added ISSUE-001.
