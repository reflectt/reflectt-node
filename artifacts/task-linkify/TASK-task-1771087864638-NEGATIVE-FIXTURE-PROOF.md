# Proof — task-1771087864638-ifxpc9ljl (Validator Negative Fixtures)

## Shipped
- Negative fixture transcripts:
  - `artifacts/task-linkify/fixtures/fixture-missing-mutation-line.txt`
  - `artifacts/task-linkify/fixtures/fixture-nonzero-mutation-endpoints.txt`
  - `artifacts/task-linkify/fixtures/fixture-missing-decision-line.txt`
  - `artifacts/task-linkify/fixtures/fixture-required-context-drift.txt`
- Negative harness:
  - `tools/task-linkify-dryrun-validator-negative-harness.ts`
- npm script:
  - `test:task-linkify:dryrun-negative-fixtures`

## Reason-Specific Guard (required)
Harness requires each fixture to fail for the expected check IDs, not generic parse/read failure:
- marker + JSON payload must be present
- payload must report `status=FAIL` and `failCount>0`
- process must exit non-zero
- expected failed check IDs must appear in actual failed check ID set

## Expected -> Actual Fail IDs
- missing mutation line -> `mutation-false` ✅
- non-zero endpoint calls -> `mutation-endpoint-calls-zero` ✅
- missing decision line -> `decision-explicit-single` ✅
- required context drift -> `required-context-exact` ✅

## Command Evidence
- `npm run build` -> PASS
- `npm run test:task-linkify:dryrun-negative-fixtures` -> PASS (4/4 cases)

Harness output marker:
- `TASK_LINKIFY_DRYRUN_NEGATIVE_HARNESS_RESULT`
