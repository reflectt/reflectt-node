# Process: task-1773606860945 — fix(node): task claim 500 — default metadata.eta

## Root cause
Schema had eta as optional (z.string().optional()) all along. applyAutoDefaults() fills it on doing-transition.
But intake-schema endpoint + docs.md listed eta as required — misleading first-run agents.

## Changes
- src/server.ts: removed eta from required[] in intake-schema; removed from required_fields in all 5 templates
- public/docs.md: POST /tasks eta now optional with default note; PATCH /tasks doing auto-defaults if absent
