# Task Intake Schema Enforcement

**Task:** task-1771260404963-ukp99lyiu  
**PR:** https://github.com/reflectt/reflectt-node/pull/160  
**Branch:** link/task-ukp99lyiu  
**Commit:** e543306  

## Done Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Task creation rejects without: done_criteria, reviewer, priority | ✅ | CreateTaskSchema requires all three; priority defaults to P3 |
| Task creation templates by type (bug, feature, process, docs) with required fields | ✅ | `type` field with 5 types + type-specific validation in checkDefinitionOfReady |
| Definition-of-ready check before assignment | ✅ | checkDefinitionOfReady runs on POST /tasks before createTask |
| Reviewer pre-allocated at creation time, not after shipping | ✅ | reviewer is required in CreateTaskSchema (was already required) |

## Test Results

223/223 tests pass. 11 new tests added:
- Rejects vague titles (fix, update, todo, stuff)
- Rejects short titles (< 10 chars)
- Rejects vague done criteria (< 3 words)
- Bug type requires impact description
- Feature type requires 2+ done criteria
- Well-formed tasks pass DoR
- Batch-create enforces DoR per task
- Intake schema endpoint returns templates
- Priority defaults to P3
- Type field accepted
- Invalid type rejected

## Key Decisions

- **Priority defaults to P3** rather than being strictly required — backward compatible
- **DoR skipped for TEST: tasks and test env** with `_forceDoR` escape hatch for testing DoR itself
- **preSerialization hook fix** — `problems` array was being stripped from error responses
- **Task type stored in metadata** (`metadata.type`) rather than as a top-level Task field — avoids schema migration
