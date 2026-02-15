# Task Creation Template (with good/weak examples)

Use this guide when creating tasks so execution and review stay fast.

## Required fields

- `title` (specific, outcome-oriented)
- `assignee` (single owner)
- `reviewer` (single reviewer)
- `done_criteria` (clear checks, not vague intent)
- `eta` (realistic delivery window)
- `createdBy`

## Task template (copy/paste)

```json
{
  "title": "<outcome + scope>",
  "description": "<what and why>",
  "status": "todo",
  "assignee": "<agent>",
  "reviewer": "<agent>",
  "done_criteria": [
    "<verifiable check 1>",
    "<verifiable check 2>",
    "<verifiable check 3>"
  ],
  "eta": "<e.g. 45m | 2h | today>",
  "createdBy": "<agent>",
  "priority": "P1"
}
```

## 5 strong examples

### 1) API endpoint feature
- **Title:** `reflectt-node: add GET /tasks/search keyword endpoint`
- **Good done criteria:**
  - `GET /tasks/search?q=claim returns matching tasks by title/description`
  - `Supports limit query param with sane max`
  - `Documented in public/docs.md with request/response example`

### 2) Dashboard behavior
- **Title:** `dashboard: show reviewer SLA badge for validating tasks`
- **Good done criteria:**
  - `Validating tasks render reviewer + elapsed review time`
  - `SLA badge changes state at threshold`
  - `Panel hides when no validating tasks`

### 3) Docs lane
- **Title:** `docs: /release endpoints runbook`
- **Good done criteria:**
  - `Runbook includes /release/status, /release/notes, /release/deploy`
  - `Includes one end-to-end deploy-mark flow`
  - `Linked from docs index`

### 4) Quality rail
- **Title:** `tasks: enforce done gate requires metadata.artifacts`
- **Good done criteria:**
  - `PATCH status=done without metadata.artifacts returns 422`
  - `Error includes actionable hint`
  - `Passing payload with artifacts + reviewer_approved closes task`

### 5) Incident prevention
- **Title:** `watchdog: suppress idle nudges for validating lanes`
- **Good done criteria:**
  - `No idle nudge when task status=validating and update <20m`
  - `Suppression reason visible in /health/idle-nudge/debug`
  - `Fixture tests cover suppression + non-suppression paths`

## Anti-patterns (avoid these)

### Weak title
- ❌ `fix tasks`
- ✅ `tasks: reject claim without contract metadata or provide 4xx guidance`

### Weak done criteria
- ❌ `works` / `looks good`
- ✅ `specific endpoint behavior + expected status code + docs update`

### Missing reviewer
- ❌ no reviewer set (task stalls in validating)
- ✅ reviewer assigned at creation

### Missing ETA
- ❌ no ETA (watchdog noise + planning ambiguity)
- ✅ explicit ETA (`45m`, `2h`, `today`)

### Missing artifact expectation
- ❌ no proof path or QA bundle
- ✅ include expected artifact path in handoff (`process/...md`) and link it in task comments

## Handoff expectation (when moving to validating)

Use `docs/REVIEWER_HANDOFF_BUNDLE_TEMPLATE.md` and include:
- PR
- commit(s)
- changed files
- test results
- proof artifact path
- criteria → evidence mapping
