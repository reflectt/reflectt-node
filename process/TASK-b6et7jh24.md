# Task: ready-queue engine v1

## PR
https://github.com/reflectt/reflectt-node/pull/546

## Changes
- `src/lane-config.ts` (new): LaneConfig interface, getLanesConfig(), getAgentLane(), checkWipLimit()
- `defaults/TEAM-ROLES.yaml`: Added lanes section
- `src/boardHealthWorker.ts`: sweepReadyQueue() with 30-min cooldown
- `src/server.ts`: WIP enforcement on /tasks/next, configurable lanes on /health/backlog
- `tests/ready-queue-engine.test.ts`: 10 tests

## Proof
- Build: clean
- Tests: 1527 pass, 0 fail
