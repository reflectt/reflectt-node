# Timeline: Insight Promotion Listener E2E Validation

**Task:** task-1771729827130-uyf1gk182  
**PR:** #232 (link/insight-promoted-listener)  

## High/Critical Auto-Create Path

| Step | Event ID | Entity | Action | Result |
|------|----------|--------|--------|--------|
| 1 | ref-h1-* | Reflection | Created with severity=high, tags stage:h1/family:h1/unit:h1 | reflection.id stored |
| 2 | insight-h1-* | Insight | ingestReflection() clusters into insight | insight.id, status=emerging, severity_max=high |
| 3 | evt-promote-h1-* | Event | eventBus.emit({ type: task_created, data: { kind: insight:promoted, insightId } }) | Bridge listener triggered |
| 4 | — | Bridge | handlePromotedInsight: severity=high → autoCreateTask path | — |
| 5 | task-h1-* | Task | taskManager.createTask({ metadata.insight_id, assignee, reviewer }) | task.id created, status=todo |
| 6 | — | Insight | updateInsightStatus(id, 'task_created', task.id) | insight.status=task_created, insight.task_id=task.id |

**Linkage:** task.metadata.insight_id → insight.id ↔ insight.task_id → task.id

## Medium/Low Triage Path

| Step | Event ID | Entity | Action | Result |
|------|----------|--------|--------|--------|
| 1 | ref-m1-* | Reflection | Created with severity=medium, tags stage:m1/family:m1/unit:m1 | reflection.id stored |
| 2 | insight-m1-* | Insight | ingestReflection() clusters into insight | insight.id, status=emerging, severity_max=medium |
| 3 | evt-promote-m1-* | Event | eventBus.emit({ kind: insight:promoted, insightId }) | Bridge listener triggered |
| 4 | — | Bridge | handlePromotedInsight: severity=medium → pending_triage path | insight.status=pending_triage |
| 5 | — | API | POST /insights/:id/triage { action: approve, assignee: link, reviewer: sage, rationale: "..." } | — |
| 6 | task-m1-* | Task | Created with metadata.insight_id | task.id created |
| 7 | triage-* | Audit | recordTriageDecision: approve, reviewer=sage, outcome_task_id=task.id | Audit persisted |
| 8 | — | Insight | updateInsightStatus(id, 'task_created', task.id) | Full lifecycle closed |

**Audit trail query:** `GET /insights/:id/triage/audit` returns: `[{ action: approve, reviewer, rationale, previous_status: pending_triage, new_status: task_created, outcome_task_id }]`

## Assignment Policy

- Non-author preference: `pickAssignee()` selects first agent not in insight.authors
- Non-author reviewer: if assignee is an author, reviewer is selected from non-authors
- Fallback: config.defaultReviewer (sage)

## Regression Guard

Test `regression: listener processes events emitted through EventBus after bridge startup`:
- Calls `startInsightTaskBridge()` to register real listener
- Emits 2 events through `eventBus.emit()` (not direct handler)
- Validates `stats.tasksAutoCreated >= 2` — proves listener survives across multiple events
- Calls `stopInsightTaskBridge()` to clean up

## Test Results
562 tests pass (1 new regression test), tsc clean.
