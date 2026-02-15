# Task Creation Template (Backlog Quality)

Use this template to create tasks that can be claimed and reviewed without clarification loops.

## Required fields

- `title` (specific, outcome-focused)
- `description` (scope + why)
- `createdBy`
- `assignee`
- `reviewer`
- `done_criteria` (array of objective checks)
- `eta`

## Copy/paste JSON template

```json
{
  "title": "area: concrete outcome",
  "description": "What to build/change and why it matters.",
  "createdBy": "agent_name",
  "assignee": "owner_name",
  "reviewer": "reviewer_name",
  "done_criteria": [
    "Criterion 1 is objectively verifiable",
    "Criterion 2 includes proof/artifact expectation",
    "Criterion 3 captures edge-case or quality gate"
  ],
  "priority": "P1",
  "eta": "45m"
}
```

## Strong examples (5)

1. **API lane:** `tasks: enforce claim contract and return 4xx not 500 on missing eta`
2. **Dashboard lane:** `dashboard: show blocked_by badge + blocker link on task cards`
3. **Docs lane:** `docs: add /tasks quickstart with status-contract table and curl flow`
4. **Quality rail:** `qa: require reviewer handoff bundle before validating verdict`
5. **Ops lane:** `ops: add launchd runbook for reflectt-node restart reliability`

## Anti-patterns (avoid)

- **Weak title:** `fix stuff`
- **Weak criteria:** `looks good`, `works on my machine`
- **Missing reviewer:** causes status-contract issues on `doing`
- **No ETA:** leads to stalled lanes and watchdog noise
- **No artifact expectation:** reviewer cannot verify quickly

## Quick quality checklist

- [ ] Title says outcome, not activity
- [ ] Criteria are testable and binary
- [ ] Reviewer is named
- [ ] ETA is realistic
- [ ] Artifact/proof expectation is explicit
