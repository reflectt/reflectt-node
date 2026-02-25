# QA Bundle — task-1771916070083-q91ysg8ca

## Summary
Provision and document a **non-author GitHub identity** for agent-side `gh` operations so reviewers can Approve/Merge PRs even when the machine’s default `gh` auth is the PR author (e.g. `itskai-dev`).

## Deliverable
- Runbook: `docs/runbooks/github-reviewer-identity.md`
  - How to run `gh` with explicit identity context using `GH_TOKEN` or `GH_CONFIG_DIR`
  - How to rotate/revoke tokens
  - Manual regression check for approving a PR authored by `itskai-dev`

## Evidence
- Local environment currently logged in as `itskai-dev` (author identity), so we need explicit context switching for reviewer actions.

## How to Validate
1) Ensure a reviewer token exists (PAT for a non-author account).
2) Run:
   - `GH_TOKEN="$GITHUB_REVIEWER_TOKEN" gh pr review <authored-by-itskai-dev> --approve`
   - `GH_TOKEN="$GITHUB_REVIEWER_TOKEN" gh pr merge <pr> --merge`
3) Confirm approval/merge succeeds.

## Caveats
- This is a runbook + operator setup. The actual PAT must be created by a human GitHub account owner.
