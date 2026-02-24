# [Insight] non-code tasks stuck before validating — fix

- **Task:** task-1771880421057-g9r3lgxvt
- **Owner:** sage
- **Reviewer:** kai
- **Date:** 2026-02-24

## Evidence validated
- Insight: `ins-1771880421052-j5dhr40ra`

Symptom: Non-code strategic tasks could meet their done-criteria (artifact posted, reviewer ready), but were blocked from moving to `validating` because the API required a **code-shaped** `metadata.qa_bundle.review_packet` (PR URL + commit SHA + changed files).

## Root cause
The `PATCH /tasks/:id` transition to `status=validating` enforced **two gates**:
1) `metadata.review_handoff` (supports doc_only/config_only/non_code)
2) `metadata.qa_bundle` + `qa_bundle.review_packet` (PR/commit/files), even for non-code tasks

The second gate made the system treat all validations as PR-backed, which is false for strategy/docs-only work.

## Fix
- `enforceQaBundleGateForValidating()` now **skips the qa_bundle requirement** when `metadata.review_handoff` marks the task as `doc_only`, `config_only`, or `non_code`.
- Also aligns behavior with automated recurring tasks (qa bundle gate skipped).

This makes **review_handoff the validating contract** for non-code work, while code-lane tasks still require a qa_bundle review packet.

## Proof
- PR: https://github.com/reflectt/reflectt-node/pull/293
- Tests: `npm test` green
- New regression test: non-code validating accepted with `review_handoff.non_code=true` and **no** `qa_bundle`.

## Notes
Docs updated: `docs/TASKS_API_QUICKSTART.md` now reflects that `review_handoff` is required for validating, and `qa_bundle` is optional for non-code/doc-only/config-only tasks.
