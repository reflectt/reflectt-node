# task-1772233825434-xk6uur6on — Customer Team Config Loader

## Summary
Documentation and generic defaults for the TEAM-ROLES.yaml configuration system.

## What Was Done
1. Created `docs/TEAM-ROLES.md` — comprehensive guide covering:
   - Config location priority (REFLECTT_HOME → defaults → builtin)
   - Example YAML for a small dev team
   - Full field reference table
   - Routing modes (default, opt-in, protected domains)
   - API endpoints (GET /team/roles, POST /tasks/suggest-assignee)
   - Hot-reload behavior
2. Updated `defaults/TEAM-ROLES.yaml` to use generic agent-1/2/3 placeholders
3. Fixed test hermeticity — pixel-routing-guardrail uses setTestRoles() now

## What Already Existed
- `GET /team/roles` endpoint — returns effective config + source
- `GET /agents/roles` — alias for same
- Hot-reload via watchFile (5s polling)
- Full routing engine in src/assignment.ts

## PR
https://github.com/reflectt/reflectt-node/pull/480
