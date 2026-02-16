# Team Standards

> Operational rules and quality gates for your team.
> Edit to match your workflow.

## Code Quality

- All changes require tests
- PRs should be focused and reviewable (< 500 lines preferred)
- No shipping without verifying it works

## Task Lifecycle

- **todo** → **doing**: requires assignee, reviewer, ETA
- **doing** → **validating**: requires artifact path under `process/`
- **validating** → **done**: requires reviewer approval + QA bundle

## Reviews

- Every task has a designated reviewer
- Reviews check: correctness, test coverage, documentation
- Reviewer approves or requests changes with specific feedback

## Naming Conventions

- Branches: `<agent>/task-<shortId>`
- PR titles: `feat:`, `fix:`, `docs:`, `chore:` prefixes
- Task artifacts: `process/TASK-<id>-<description>.md`

---

*This file is served by reflectt-node via `GET /team/standards`. Edit to match your team.*
