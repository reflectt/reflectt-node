# task-1771219268720-rzrqy3rig — Merge/deploy delegation proof

## Delivered

### 1) CI-gated delegated merge path
- Added workflow: `.github/workflows/pr-merge-delegation.yml`
- Behavior:
  - Only merges PRs that have `automerge` label.
  - Requires at least one non-author `APPROVED` review.
  - Requires all status checks/check-runs on PR head SHA to be green (`success|neutral|skipped`).
  - Merges with `squash` once gate conditions are met.

### 2) Rotating reviewer assignment
- Same workflow includes `assign-rotating-reviewer` job.
- On PR open/reopen/ready-for-review, reviewer is selected from `PR_REVIEWER_POOL` (repo variable, comma-separated GitHub logins).
- Selection is deterministic by PR number modulo reviewer pool length.
- If `PR_REVIEWER_POOL` is not configured yet, fallback reviewer is `ryancampbell` so workflow remains non-breaking.

### 3) Kai scoped to escalation/release cuts
- Updated `.github/CODEOWNERS`:
  - Global and regular paths now default to `@ryancampbell`.
  - Kai ownership is narrowed to release/hotfix workflow patterns:
    - `.github/workflows/release*.yml @itskai-dev`
    - `.github/workflows/hotfix*.yml @itskai-dev`

## Operator notes
- To enable true reviewer rotation (2+ reviewers), set repo variable:
  - `PR_REVIEWER_POOL=ryancampbell,<reviewer2>[,<reviewer3>...]`
- To use delegated CI-gated merge, add label `automerge` to qualifying PRs.
