# task-1772241124743-2e1vgqrv3 — REFLECTT_HOME Config Paths

## Summary
All config file paths now consistently use REFLECTT_HOME from config.ts.

## Changes
- `src/assignment.ts`: Import REFLECTT_HOME from config.ts, remove duplicate homedir fallback
- `src/bootstrap-team.ts`: Reference $REFLECTT_HOME in user-facing messages
- `src/policy.ts`: Use REFLECTT_HOME for policy.json path
- `docs/TEAM-ROLES.md`: Document REFLECTT_HOME override + example
- `tests/reflectt-home-config.test.ts`: Regression test for config path derivation

## PR
https://github.com/reflectt/reflectt-node/pull/501
