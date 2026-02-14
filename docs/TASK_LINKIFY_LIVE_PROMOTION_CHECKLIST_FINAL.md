# Task-Linkify Live Promotion Checklist (Final Freeze)

Task: `task-1771075286830-fc7rpn861`
Required check contract: `task-linkify-regression-gate`

## Execution Order (Frozen)

### 1) Preflight auth + target validation
- Commands:
  - `gh auth status`
  - `gh repo view reflectt/reflectt-node --json nameWithOwner,defaultBranchRef,url`
- Evidence capture:
  - auth excerpt
  - repo/branch confirmation
- Pause/Confirm #1: reviewer confirms operator identity + target correctness.

### 2) Backup snapshot capture
- Command:
  - `gh api repos/reflectt/reflectt-node/branches/main/protection > artifacts/task-linkify/branch-protection-backup-<timestamp>.json`
- Evidence capture:
  - backup path
  - timestamp
  - checksum/hash (optional but recommended)
- Pause/Confirm #2: reviewer confirms backup file exists/readable.

### 3) Baseline read capture (verbatim)
- Command:
  - `./tools/task-linkify-branch-protection-playbook.sh read`
- Evidence capture:
  - `strict`
  - `required_contexts_pre` (verbatim)
  - merged preview
- Pause/Confirm #3: reviewer confirms preservation baseline is fully captured.

### 4) Pre-mutation dual confirmation (hard gate)
- Required:
  - operator explicit go
  - reviewer explicit go
- **Hard stop rule:** if Pause/Confirm #4 dual confirmation is missing, execution must auto-abort with **no changes**.
- Evidence capture:
  - operator confirmation record
  - reviewer confirmation record

### 5) Guarded apply (next-cycle live step)
- Command:
  - `./tools/task-linkify-branch-protection-playbook.sh apply`
- Expected behavior:
  - merge-safe context preservation (no clobber)
  - append required check only if missing
  - `strict=true`
- Evidence capture:
  - apply output excerpt
  - confirmation-token acknowledgment

### 6) Post-apply verify
- Command:
  - `./tools/task-linkify-branch-protection-playbook.sh read`
- Evidence capture:
  - `strict=true`
  - contexts post-apply
  - preservation audit pass
- Pause/Confirm #5: reviewer confirms matrix pass.

### 7) PR/run + artifact verification
- Capture:
  - PR number + URL
  - run id + URL
  - check visibility with exact name `task-linkify-regression-gate`
  - artifact `task-linkify-regression-output` present, non-expired, non-zero, same run id
- Pause/Confirm #6: reviewer confirms end-to-end integrity.

## Decision Gates

### Default rollback (primary)
Trigger if any matrix-critical mismatch appears.
Action: restore from backup snapshot immediately.

### Emergency temporary degraded mode (secondary)
Use only for urgent unblock when primary restore path is temporarily infeasible.
Must be explicitly time-bounded and incident-scoped.
Must be followed by full restore/re-apply to intended state ASAP.

## Go / No-Go Criteria

### GO
- All pause/confirm points completed
- Hard gate #4 dual confirmation present
- Preservation and strict checks pass
- PR check + artifact linkage verified

### NO-GO
- Missing backup/verbatim baseline
- Missing dual confirmation at gate #4
- Context clobber or strict mismatch
- Artifact/check mismatch

## Final Signoff Schema
- operator
- reviewer
- timestamp_utc
- backup_snapshot_path
- pr_number
- run_id
- run_url
- artifact_name/id
- decision (go-live pass / rollback / hold)
- follow-up owner + ETA
