# QA: Triage Queue Model for Medium/Low Promoted Insights

**Task:** task-1771729827008-q1xhvjwta  
**PR:** #232 (link/insight-promoted-listener)  
**Commits:** 18a3f3a + triage audit fix  

## Done Criteria Evidence

### 1. pending_triage status in insight lifecycle
✅ `updateInsightStatus(insight.id, 'pending_triage')` in insight-task-bridge.ts for medium/low severity

### 2. API endpoints for listing and resolving triage items
✅ `GET /insights/triage` — lists pending_triage insights  
✅ `POST /insights/:id/triage` — approve (create task) or dismiss  

### 3. Decision logging with reviewer + rationale
✅ `triage_audit` SQLite table persists every decision:
- `id`, `insight_id`, `action` (approve|dismiss), `reviewer`, `rationale`, `outcome_task_id`, `previous_status`, `new_status`, `timestamp`
- Both approve and dismiss paths call `recordTriageDecision()`

### 4. Promote-from-triage creates linked task
✅ Approve path creates task with `metadata.insight_id`  
✅ Insight status updated to `task_created` with `task_id` linkage

### 5. Audit trail: entry → decision → outcome
✅ `GET /insights/triage/audit` — full audit trail across all insights  
✅ `GET /insights/:id/triage/audit` — per-insight lifecycle trail  
✅ Each record captures: previous_status → new_status, reviewer, rationale, outcome_task_id

## API Evidence

### Before (no audit)
```
POST /insights/abc/triage { action: "approve", assignee: "link" }
→ { success: true, task_id: "task-123" }
# No record of who approved or why
```

### After (full audit)
```
POST /insights/abc/triage { action: "approve", assignee: "link", reviewer: "sage", rationale: "High customer impact" }
→ { success: true, task_id: "task-123", reviewer: "sage" }

GET /insights/abc/triage/audit
→ { audit: [{ action: "approve", reviewer: "sage", rationale: "High customer impact", outcome_task_id: "task-123", previous_status: "pending_triage", new_status: "task_created" }] }
```

## Test Results
561 tests pass, tsc clean.
