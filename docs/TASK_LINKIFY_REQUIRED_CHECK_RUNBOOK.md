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
### UI Path
1. Open GitHub: **Settings → Branches → Branch protection rule (`main`)**.
2. Ensure **Require status checks to pass before merging** is enabled.
3. Ensure **Require branches to be up to date before merging** is enabled. *(hardening add-on)*
4. Add required status check: `task-linkify-regression-gate`.
5. Save rule.
6. Validate on a fresh PR that:
   - check appears with exact name,
   - check executes and reports status,
   - merges are blocked if check fails.

### API/CLI Path (merge-safe)
Use `tools/task-linkify-branch-protection-playbook.sh`:
- Non-mutating read: `./tools/task-linkify-branch-protection-playbook.sh read`
- Apply (with explicit confirmation guard): `./tools/task-linkify-branch-protection-playbook.sh apply`

**Merge-safe mutation behavior:**
- reads existing required contexts,
- appends `task-linkify-regression-gate` only if missing,
- PATCHes the full merged context set (no clobber of existing checks),
- sets `strict=true` to enforce up-to-date requirement.

## Rollback Path (unexpected merge blockage)
### Primary rollback (preferred)
1. Restore full branch-protection snapshot backup:
   - `./tools/task-linkify-branch-protection-playbook.sh rollback-restore <backup-json-path>`
2. Verify restored state with read mode.

### Emergency rollback (temporary degraded mode only)
- `./tools/task-linkify-branch-protection-playbook.sh rollback-temporary-degraded`
- This is explicitly temporary/scoped incident mitigation.
- It must be followed by backup restore or re-apply of full intended protection state ASAP.


## Validation Evidence Requirements
Capture and store in artifacts:
- Branch protection screenshot showing required check list and up-to-date toggle state.
- CI run URL and job-step proof for `task-linkify-regression-gate`.
- Artifact listing for `task-linkify-regression-output`.
- Timestamp and PR reference fields in evidence bundle.

## Decision Policy
- Current cycle: standalone only.
- Next cycle: promote to required after one more clean verification window.
