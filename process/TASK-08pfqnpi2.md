# Task: task-1773617908405-08pfqnpi2 — fix(idle-nudge): lane-scoped queue-empty suppression

## Artifact
PR: https://github.com/reflectt/reflectt-node/pull/1063 (pending)

## Changes
- src/health.ts:
  - Imported `getAgentLane` from `./lane-config.js`
  - Queue-empty check in `no-active-lane` handler: if the next available task is in a different lane than the agent, treat as queue-empty and suppress
  - artdirector with 0 design tasks but other lanes having tasks → suppressed (correct)
  - Support-lane exemption logic (PR #1051) untouched
- tests/idle-nudge-lane-scoped.test.ts: 3 tests

## AC
- [x] Idle suppression checks lane-specific task count for the escalating agent
- [x] artdirector with 0 design tasks but active work does not trigger idle watchdog
- [x] Support-lane exemption logic untouched
- [x] Test added for lane-scoped queue-empty suppression
