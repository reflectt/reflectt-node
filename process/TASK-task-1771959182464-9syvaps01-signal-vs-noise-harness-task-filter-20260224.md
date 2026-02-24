# task-1771959182464-9syvaps01 — Signal-vs-noise gap: test-harness tasks polluting live backlog

**PR:** (pending)  
**Owner:** link  
**Reviewer:** pixel  
**Date:** 2026-02-24

## Problem (from insight ins-1771959182435-kch9b5yji)

The reflection→insight→task pipeline is generating **test-harness validation tasks** (e.g. `source_reflection=ref-test-*`, `source_insight=ins-test-*`, or titles containing `test run <timestamp>`). These tasks are stored in the **live task DB** and were being counted by:

- `/tasks` lists
- `/tasks/board-health` totals and per-agent todo counts
- reviewer suggestion + other heuristics that call `taskManager.listTasks({})`

This inflates backlog metrics (signal-vs-noise failure) and can cause load-balancing to think an agent has massive todo work when it’s mostly harness noise.

## Root cause

We had a partial mitigation: `/tasks/next` filters out test-harness tasks when selecting a next task.

However, **board and analytics surfaces** still used `taskManager.listTasks()` which returned *all* tasks, including harness noise.

## Fix

### 1) Make test-harness tasks ignorable everywhere by default

`TaskManager.listTasks()` now filters out test-harness tasks unless `includeTest: true` is passed.

Definition (consistent with the existing `/tasks/next` filter):
- `metadata.is_test === true`
- `metadata.source_reflection` starts with `ref-test-`
- `metadata.source_insight` starts with `ins-test-`
- title matches `test run \d{13}`

This automatically fixes `/tasks/board-health` and other consumers that rely on `listTasks()`.

### 2) Add a client escape hatch

`GET /tasks` and `GET /tasks/search` accept `include_test=1|true` to include filtered harness tasks.

### 3) Tag new test-harness tasks at ingestion

`POST /tasks` and `POST /tasks/batch-create` now auto-set `metadata.is_test=true` when the task metadata indicates a harness task (via the markers above). This helps downstream filters and makes the classification explicit.

## Evidence / verification

### Tests

Added integration tests to `tests/api.test.ts`:
- test-harness tasks are excluded from `/tasks` by default, included with `include_test=1`
- test-harness tasks do **not** count toward `/tasks/board-health` per-agent todo totals

All tests:
- `npm test --silent` → **989 passed**, 1 skipped

## Notes / caveats

- This is an **exclusion** mitigation (signal restoration) rather than hard-deleting existing harness tasks.
- Follow-up option (not required for this task): add a periodic pruner to delete old `is_test` tasks.
