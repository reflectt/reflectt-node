# Agent Interface MVP — Execution Plan v1

**Task:** task-1773257734617-6fvzfl52z
**Engineering owner:** link
**Reviewer gate owner:** pixel

---

## Goal

Agent completes one end-to-end software action on behalf of user (create GitHub issue)
with auditable run log + human approval gate.

## In scope (v1)

1. Agent executes browser flow to create issue (repo + title + body)
2. Action is represented as a run with status timeline (`queued → running → awaiting_approval → completed|failed`)
3. Human approval required before irreversible submit
4. Full run log persisted (inputs, decisions, timestamps, outcome, link to created issue)

## Out of scope (v1)

- Multi-step chained automations
- Permission self-escalation
- Autonomous destructive actions

---

## Required interfaces

### Execution request
- `POST /agent-interface/runs`
- Body: `{ kind: "github_issue_create", repo, title, body, dryRun? }`
- Returns: `{ runId, status }`

### Run events stream
- `GET /agent-interface/runs/:runId/events` (SSE)
- Emits: `state_changed`, `step_started`, `step_succeeded`, `step_failed`, `approval_requested`, `approval_resolved`

### Approval action
- `POST /agent-interface/runs/:runId/approve`
- `POST /agent-interface/runs/:runId/reject`

---

## Non-negotiable safety/UX gates (Pixel reviewer gate)

Must pass all 5:
1. No human keyboard/mouse needed for the agent action path
2. Human approval surface is reachable (`/approvals` and/or presence surface)
3. Irreversible submit requires explicit confirm
4. Agent cannot self-escalate permissions
5. Fallback exists if agent stalls/offline (timeout + resumable/retry path)

---

## Done criteria

- One successful real run creates a GitHub issue and stores resulting URL
- One rejected run proves approval gate blocks submit
- One failure run captures explicit error + recovery hint
- Run log query returns complete trace for all three scenarios
- Pixel reviewer gate passes 5/5

---

## Required proof artifact in task comment

- commit SHA
- changed files list
- 3 run IDs (success/reject/fail)
- created issue URL (success run)
- approval event evidence
- screenshot or log excerpt for each run state transition
