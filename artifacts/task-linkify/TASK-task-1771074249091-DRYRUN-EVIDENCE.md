# Dry-Run Evidence Pack — task-1771074249091-9dquhcf9e

## Metadata (explicit)
- Timestamp (UTC): `2026-02-14T13:06:31Z`
- Validation mode: `workflow_dispatch` (non-PR dry run)
- PR number (explicit field): `N/A (dispatch run)`
- Reference PR number (repo baseline): `#2`

## Revision / Contract
- Commit: `f5bfd2a`
- Branch: `main`
- Required-check contract string: `task-linkify-regression-gate`

## Dry-Run Execution
- Workflow: `idle-nudge-regression.yml`
- Run id: `22017936485`
- URL: `https://github.com/reflectt/reflectt-node/actions/runs/22017936485`
- Conclusion: `success`

## Job/Step Evidence (task-linkify job)
- Job: `task-linkify-regression-gate` → `success`
- Step order observed:
  1. Checkout
  2. Setup Node
  3. Install deps
  4. Build
  5. Ensure task-linkify artifact directory exists
  6. Run task-linkify regression harness
  7. Upload task-linkify regression artifact
- Artifact upload behavior:
  - step executed and succeeded
  - configured with `if: always()` + `if-no-files-found: warn`

## Artifact Evidence
- Name: `task-linkify-regression-output`
- Artifact id: `5511011672`
- Size: `867` bytes
- Expired: `false`

## Promotion Timing Confirmation
- This cycle: keep standalone.
- Next cycle: promote `task-linkify-regression-gate` to required check on `main` after branch-protection toggle validation (`Require branches to be up to date before merging` enabled).
