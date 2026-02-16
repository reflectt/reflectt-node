# Model Performance Tracking

## Task
task-1771269312935-3ltiwdgc6 — Model performance tracking: record LLM model per task completion + analytics endpoint

## Changes
- src/analytics.ts: getModelAnalytics() + getAgentModelAnalytics() — tracks per-model and per-agent stats
- src/server.ts: GET /analytics/models + GET /analytics/agents endpoints
- tests/api.test.ts: 3 new tests

## Evidence
- PR: https://github.com/reflectt/reflectt-node/pull/132
- Commit: 56281f8
- Build: tsc clean
- Tests: 93/97 passing (4 pre-existing failures on main)
