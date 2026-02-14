# Promotion-Day Required-Check Toggle Dry-Run Skeleton

Task: `task-1771083966546-7wjfad0oa`
Mode: **NON-MUTATING**

## Runtime Assertions (must pass before any step)
- `assert(MUTATION === "false")`
- `echo "MUTATION=${MUTATION}"` and capture in transcript
- hard-fail guard:
  - if `MUTATION` unset -> `HOLD` + exit non-zero
  - if `MUTATION != false` -> `HOLD` + exit non-zero

## Command-by-Command Dry-Run Transcript Skeleton
> Record each command + output + exit code.

1. Preflight environment
   - command: `export MUTATION=false`
   - command: `echo "MUTATION=${MUTATION}"`
   - expected: `MUTATION=false`

2. Branch-protection read snapshot (read-only)
   - command: `<read-only snapshot command>`
   - artifact: `...-BRANCH-PROTECTION-SNAPSHOT.json`
   - expected: snapshot file created

3. Required-check contract verify
   - command: `<verify exact required check string>`
   - expected exact: `task-linkify-regression-gate`

4. Dry-run toggle simulation
   - command: `<playbook command with --dry-run>`
   - expected: no mutation calls

5. Mutation-path guard proof
   - command: `<scan transcript for PATCH|PUT|POST to protection endpoints>`
   - expected: none found
   - required transcript line: `MUTATION_ENDPOINT_CALLS=0`

6. Rollback reference check
   - command: `<validate backup/snapshot reference exists>`
   - expected: rollback reference present

7. Decision emit
   - command: `<write summary artifact>`
   - expected output: `DECISION=GO` or `DECISION=HOLD` + reasons

## GO/HOLD Criteria Matrix

### GO (all required)
- `MUTATION=false` asserted and logged
- no mutating API verbs/endpoints invoked
- required-check string exactly `task-linkify-regression-gate`
- full transcript + artifacts saved and timestamped
- rollback reference present and valid

### HOLD (any one blocks)
- `MUTATION` missing or not `false`
- required-check contract mismatch/drift
- mutating path invoked anywhere in transcript
- transcript/artifacts incomplete
- rollback reference missing

## Signoff
- `operator`: 
- `reviewer`: 
- `timestamp_utc`: 
- `ref`: 
