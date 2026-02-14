# Rehearsal Transcript Template — task-1771075068288-8oqn22791

## Header
- timestamp_utc:
- operator:
- reviewer:
- repo: reflectt/reflectt-node
- branch: main
- required_check_contract: task-linkify-regression-gate
- MUTATION: false

## Command Log

### 1) Auth status
- command: `gh auth status`
- output_excerpt:
- pass_fail:
- notes:

### 2) Repo target
- command: `gh repo view reflectt/reflectt-node`
- output_excerpt:
- pass_fail:
- notes:

### 3) Branch-protection read
- command: `./tools/task-linkify-branch-protection-playbook.sh read`
- output_excerpt:
- strict:
- required_contexts_pre_verbatim:
```text

```
- has_required_context(task-linkify-regression-gate):
- merged_context_preview:
```text

```
- pass_fail:
- notes:

### 4) Latest workflow run lookup
- command: `gh run list --repo reflectt/reflectt-node --workflow idle-nudge-regression.yml --limit 1`
- run_id:
- run_url:
- output_excerpt:
- pass_fail:
- notes:

### 5) Artifact verification
- command: `gh api repos/reflectt/reflectt-node/actions/runs/<run_id>/artifacts`
- artifact_name:
- artifact_non_expired:
- artifact_size_bytes:
- artifact_run_id_match:
- output_excerpt:
- pass_fail:
- notes:

## Verification Matrix
| Check | Expected | Actual | Pass/Fail |
|---|---|---|---|
| strict present in read output | yes |  |  |
| required_contexts_pre captured verbatim | yes |  |  |
| contains task-linkify-regression-gate | yes |  |  |
| merged preview includes target check | yes |  |  |
| run id/url captured | yes |  |  |
| artifact output valid (name/non-expired/non-zero/run-id match) | yes |  |  |

## Go/No-Go
- decision: GO / NO-GO
- abort_conditions_triggered:
- follow_up:

## Signoff
- operator:
- reviewer:
- timestamp_utc:
- ref:
