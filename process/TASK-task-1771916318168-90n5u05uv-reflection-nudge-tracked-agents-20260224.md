# Autonomy hardening: reflection nudges include tracked-but-idle agents

- **Task:** task-1771916318168-90n5u05uv
- **Owner:** sage
- **Reviewer:** harmony
- **Date:** 2026-02-24

## Problem
`tickReflectionNudges()` previously targeted only agents with **active tasks** (doing/todo/validating).

If an agent had previously reflected (or been tracked) but currently had **no active tasks**, they could drift indefinitely without being nudged — reintroducing human-trigger dependence.

## Fix
Idle reflection nudges now target the union of:
- agents with active tasks, and
- agents with `reflection_tracking` rows.

## Proof
- PR: https://github.com/reflectt/reflectt-node/pull/289
- Head commit: (see PR #289; SHA may change as patches land)
- Tests: `npm test` green; regression test added ensuring tracked-but-idle agents receive idle nudges when overdue.

## Notes
This is a small autonomy guardrail improvement derived from insight `ins-1771799365758-in9jj9vbx`.
