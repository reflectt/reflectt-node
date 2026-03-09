# Cost Dashboard — GET /costs + api_source field

**Task**: task-1773089482801  
**Agent**: @attribution  
**PR**: https://github.com/reflectt/reflectt-node/pull/840  
**Status**: validating

## What was built

`GET /costs?days=N` endpoint returning:
- `daily_by_model` — spend by model per day
- `daily_totals` — rolled-up per-day totals (for sparklines / threshold alerting)
- `avg_cost_by_lane` — avg cost per closed task by `qa_bundle.lane`
- `top_tasks_by_cost` — top 20 most expensive tasks in window
- `summary` — total tokens + cost

`api_source` field on `model_usage` table (e.g. `anthropic_direct`, `openai_codex`) for key-switch correlation.

## Tests
8 new tests in `tests/cost-dashboard.test.ts` — all green.
Full suite: 151/151 files, 1810/1810 passing.

## Done criteria
- [x] Daily spend by model
- [x] Average cost per closed task by lane
- [x] Most expensive tasks this week
- [x] `metadata.api_source` field on usage events
- [x] Tests passing
- [ ] PR merged
