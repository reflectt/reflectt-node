# TASK task-1771255522531-i3nhcebwl — Canonical review handoff contract + validator

## Summary
Implemented an enforced review handoff contract across task transition + chat action messages to prevent incomplete review requests and validating transitions without mergeable context.

## Shipped changes

### 1) Validating transition: `review_handoff` gate (enforced)
- Added `ReviewHandoffSchema` and `enforceReviewHandoffGateForValidating(...)` in `src/server.ts`.
- `PATCH /tasks/:id` to `status=validating` now rejects unless metadata includes:
  - `review_handoff.task_id` (must match task id)
  - `review_handoff.repo`
  - `review_handoff.artifact_path` (canonical `process/...`)
  - `review_handoff.test_proof`
  - `review_handoff.known_caveats`
  - plus `review_handoff.pr_url` + `review_handoff.commit_sha` unless `review_handoff.doc_only=true`
- Returns structured gate response:
  - `gate: "review_handoff"`
  - actionable `hint`

### 2) Re-review delta-note requirement (enforced)
- Added re-review gate in `PATCH /tasks/:id`:
  - if task is already `validating` and is set to `validating` again (non-recurring), request must include `metadata.review_delta_note` (or equivalent alias keys accepted in code).
- Returns structured gate response:
  - `gate: "review_delta"`
  - clear hint to include what changed since last SHA.

### 3) Action-required message contract in chat
- Added action message validation in `POST /chat/messages`:
  - Strict channels (`reviews`, `blockers`): require both `@owner` and `task-...` or request is rejected.
  - Other channels (`general` etc.): likely action-required messages are allowed but return `action_warnings` when owner/task reference is missing.
- Returns structured gate response on strict-channel failure:
  - `gate: "action_message_contract"`

## Test coverage added/updated
- `tests/api.test.ts`
  - New suite: **Validating review handoff gate**
    - rejects validating without `review_handoff`
    - rejects validating without PR/SHA unless `doc_only=true`
    - enforces `review_delta_note` on re-review
  - Updated validating fixtures to include `review_handoff`
  - Added chat contract tests:
    - strict channel block without `@owner + task-id`
    - general-channel warn path for likely action-required messages

## Verification
Command:
```bash
npm test -- --run tests/api.test.ts
```
Result:
- `Test Files: 1 passed`
- `Tests: 82 passed`
- Exit code `0`

## Notes
- `doc_only=true` provides the explicit docs-only override path requested in scope.
- Recurring automated tasks are excluded from these validating gates to avoid regression on system-generated task flow.
