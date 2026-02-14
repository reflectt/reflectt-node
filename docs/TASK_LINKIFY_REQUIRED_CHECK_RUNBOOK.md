# Task-Linkify Required Check Promotion Runbook

## Scope
Promote CI status check `task-linkify-regression-gate` from standalone (informational) to required on `main` **next cycle**.

## Required-Check Contract (locked)
- Check name: `task-linkify-regression-gate`
- Source workflow: `.github/workflows/idle-nudge-regression.yml`
- Trigger coverage: push/main, pull_request, workflow_dispatch, workflow-file self-trigger path.

## Branch Protection Target
- Repository: `reflectt/reflectt-node`
- Branch rule target: `main`

## Promotion Toggle Sequence (next cycle)
1. Open GitHub: **Settings → Branches → Branch protection rule (`main`)**.
2. Ensure **Require status checks to pass before merging** is enabled.
3. Ensure **Require branches to be up to date before merging** is enabled. *(hardening add-on)*
4. Add required status check: `task-linkify-regression-gate`.
5. Save rule.
6. Validate on a fresh PR that:
   - check appears with exact name,
   - check executes and reports status,
   - merges are blocked if check fails.

## Rollback Path (unexpected merge blockage)
1. Open branch protection rule for `main`.
2. Remove `task-linkify-regression-gate` from required checks
   - or temporarily disable required checks gate.
3. Save changes to unblock urgent merges.
4. Keep workflow job running standalone while patching.
5. Re-validate with fresh run evidence; re-enable required check in next safe window.

## Validation Evidence Requirements
Capture and store in artifacts:
- Branch protection screenshot showing required check list and up-to-date toggle state.
- CI run URL and job-step proof for `task-linkify-regression-gate`.
- Artifact listing for `task-linkify-regression-output`.
- Timestamp and PR reference fields in evidence bundle.

## Decision Policy
- Current cycle: standalone only.
- Next cycle: promote to required after one more clean verification window.
