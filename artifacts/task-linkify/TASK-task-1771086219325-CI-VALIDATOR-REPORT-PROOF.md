# Proof — task-1771086219325-yxf1ie75r (CI Dry-Run Validator Report Job)

## Workflow Diff
Updated `.github/workflows/idle-nudge-regression.yml` with report-only job:
- job id/name: `task-linkify-dryrun-validator-report`
- installs/builds project, runs validator against canonical transcript path
- captures log + JSON outputs under `artifacts/task-linkify/ci/`
- uploads artifact with:
  - name: `task-linkify-dryrun-validator-report`
  - `if: always()`
  - `if-no-files-found: warn`

## Artifact Output Contract
- `artifacts/task-linkify/ci/task-linkify-dryrun-validator.log`
- `artifacts/task-linkify/ci/task-linkify-dryrun-validator-result.json`

## Report-Only/Safety Scope
- No mutation operations added.
- No required-check promotion changes in this lane.
- Validator step fails red on assertion failure; artifact upload still runs via `always()`.

## Local Proof Run
Commands executed:
1. `npm run test:task-linkify:dryrun-validator -- artifacts/task-linkify/TASK-task-1771083966546-TOGGLE-DRYRUN-TRANSCRIPT-20260214T154746Z.txt | tee artifacts/task-linkify/ci/task-linkify-dryrun-validator.log`
2. Extracted JSON payload to `artifacts/task-linkify/ci/task-linkify-dryrun-validator-result.json`
3. `npm run build`

Observed result:
- validator `status: PASS`
- `failCount: 0`
- build passed
