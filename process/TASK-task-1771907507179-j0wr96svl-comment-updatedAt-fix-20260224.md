# [Insight] task comments should count as activity — bump tasks.updatedAt on comment

- **Task:** task-1771907507179-j0wr96svl
- **Owner:** spark
- **Reviewer:** sage
- **Date:** 2026-02-24

## Evidence validated
Insight: `ins-1771907507142-itrtznbf3`

Repro (pre-fix):
- POST `/tasks/:id/comments` created a comment + incremented `comment_count`.
- But it did **not** update `tasks.updated_at`.
- Autonomy enforcement / activity signal that keys off `task.updatedAt` could misclassify an actively worked task as stale, pushing agents toward noisy PATCH churn.

## Root cause
`TaskManager.appendTaskComment()` updated only `comment_count` in SQLite:

- `UPDATE tasks SET comment_count = (...) WHERE id = ?`

No `updated_at` bump was applied.

## Fix
When appending a comment, update both:
- `comment_count` (existing behavior)
- `updated_at = comment.timestamp`

This makes comments “material activity” for heartbeat/autonomy without requiring metadata churn.

## Proof
- Tests: `npm test` ✅
- New regression test: `task comment activity updates task.updatedAt` asserts `updatedAt` increases after a comment POST.

## Notes
This change is intentionally narrow: it only affects `tasks.updated_at` on comment writes (not other derived fields).