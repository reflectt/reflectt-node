# Proof — task-1771287936503-0c2v1rxgl

## Scope
Implemented hard-gate validation for `status=validating` so review packet fields are required and clear error messages identify missing/invalid fields.

## Changed files
- `src/server.ts`
- `tests/api.test.ts`

## What changed
- Added `ReviewPacketSchema` with required fields:
  - `task_id`
  - `pr_url` (GitHub PR URL)
  - `commit`
  - `changed_files[]`
  - `artifact_path` (`process/...`)
  - `caveats`
- Extended `QaBundleSchema` to require `review_packet`.
- Strengthened `enforceQaBundleGateForValidating`:
  - blocks transition when review packet is missing/invalid
  - reports precise missing/invalid paths and reasons
  - enforces review packet `task_id` matches current task
  - enforces review packet `artifact_path` matches `metadata.artifact_path`
- Updated validating-path tests to provide review packet payload.
- Added dedicated tests for:
  - blocked validating transition when review packet fields are missing
  - clear mismatch error for wrong `task_id`

## Validation
- Command: `npm test -- tests/api.test.ts`
- Result: PASS (94/94)
- Test log artifact: `process/TASK-task-1771287936503-0c2v1rxgl-test.log`

## Caveats
- Existing integrations that only send legacy `qa_bundle { summary, artifact_links, checks }` must now include `qa_bundle.review_packet` for `status=validating` transitions.
