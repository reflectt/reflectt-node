# Task: task-1773598309719-8e9iqpuln — feat(node): canvas_artifact typed events

## Artifact
PR: https://github.com/reflectt/reflectt-node/pull/1064 (pending)

## Status
Both emit sites were already implemented. This PR adds documentation and tests.

## Emit Sites (pre-existing)
- src/server.ts line ~16356: `canvas_artifact(type=test)` on `workflow_run completed` webhook — passes/failed/skipped from check_runs
- src/server.ts line ~17654: `canvas_artifact(type=run)` on PATCH /agents/:id/runs/:runId with terminal status — duration/exitCode

## Changes
- tests/canvas-artifact-typed.test.ts: 3 tests verifying run completion and CI webhook paths

## AC
- [x] node emits canvas_artifact(type=test) on CI run complete with passed/failed/skipped
- [x] node emits canvas_artifact(type=run) on agent run completion with duration/exitCode
