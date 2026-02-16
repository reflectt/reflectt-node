# Test Isolation

## Task
task-1771278426671-pmxpluwf6 — Test isolation: ensure CI and agent test runs never touch production SQLite DB

## Changes
- tests/setup.ts: mkdtemp + REFLECTT_HOME isolation
- vitest.config.ts: setup file registration

## Evidence
- PR: https://github.com/reflectt/reflectt-node/pull/139
- Commit: a46b487
- Build: tsc clean
- Tests: 99/108 passing (9 pre-existing on main)
- Verified: REFLECTT_HOME=/var/folders/.../reflectt-test-WkDFEH in test output
