# TASK-5q7lvqq0d — Review SLA breach detector false positives

## Symptoms
- SLA breach alert fired for tasks that were already **done**.
- Alert reported absurd ages (e.g. "~1.3M minutes") which indicates mixed timestamp units.

## Fix
- **Race/status guard:** when generating review-SLA actions, re-fetch the task and ensure it is still `status=validating` before acting.
- **Timestamp normalization:** normalize `metadata.entered_validating_at` and `metadata.review_last_activity_at`:
  - if epoch value is suspiciously small (< 1e11), treat as **seconds** and convert to **ms**
  - clamp future timestamps to `now`

## Regression tests
- Done tasks are never flagged.
- `entered_validating_at` recorded in seconds triggers reassignment without printing huge-minute values.

## PR
- https://github.com/reflectt/reflectt-node/pull/484
