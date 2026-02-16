# Role-Based Assignment Engine

## Task
`task-1771260391479-fwyrvctba`

## Summary
New `src/assignment.ts` module with agent role registry, affinity scoring, WIP cap enforcement, and protected domain routing. Three server endpoints: role registry, suggest-assignee, and WIP cap gate on doing transitions.

## Changes
- `src/assignment.ts`: 208 lines — complete assignment engine
- `src/server.ts`: 70 lines — endpoints + WIP gate
- `tests/api.test.ts`: 122 lines — 7 new tests

## Tests
All 87 passing.

## PR
https://github.com/reflectt/reflectt-node/pull/121
