# Task: task-1773606860945 — fix(node): task claim 500 — default metadata.eta

## Artifact
- Node PR #1053: https://github.com/reflectt/reflectt-node/pull/1053 (MERGED ✅)

## What was done
POST /tasks/:id/claim returned 500 when task was created without eta.
Fix: inject default eta in claim handler based on priority (P0/P1=~2h, P2/P3=~4h).
Also removed eta from required[] in intake-schema and 5 TASK_TEMPLATES.
Updated public/docs.md to reflect eta as optional.
