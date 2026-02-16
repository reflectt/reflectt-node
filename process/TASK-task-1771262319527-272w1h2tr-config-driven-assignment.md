# Config-Driven Assignment Engine

## Task
task-1771262319527-272w1h2tr — Make assignment engine config-driven from ~/.reflectt/TEAM-ROLES.yaml

## Changes
- **src/assignment.ts**: YAML loading from ~/.reflectt/TEAM-ROLES.yaml with fallback chain (user config → defaults/ → builtin)
- **defaults/TEAM-ROLES.yaml**: Default template with all current agent roles
- **src/server.ts**: loadAgentRoles() + startConfigWatch() on startup; config source in /agents/roles
- **tests/api.test.ts**: 2 new tests for config source + agent fields

## Evidence
- PR: https://github.com/reflectt/reflectt-node/pull/123
- Commit: 4b4b75b
- Build: tsc clean
- Tests: 93/93 passing (2 new)

## Done Criteria
- ✅ Agent registry loads from ~/.reflectt/TEAM-ROLES.yaml
- ✅ Falls back to built-in defaults if missing
- ✅ YAML schema: name, role, affinityTags, protectedDomains, wipCap
- ✅ GET /agents/roles reflects YAML contents + source info
- ✅ Default TEAM-ROLES.yaml template in defaults/
- ✅ All tests pass with both YAML-loaded and fallback configs
