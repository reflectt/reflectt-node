# Task-Linkify Required-Check Promotion — Operator Handoff

Task: `task-1771074926440-zr2ktct67`
Contract check name: `task-linkify-regression-gate`

## 1) Preflight Gates (all required)

- [ ] **Auth gate**: `gh auth status` confirms admin-capable auth for `reflectt/reflectt-node`.
- [ ] **Target gate**: repo=`reflectt/reflectt-node`, branch=`main`.
- [ ] **Backup gate**: fresh branch-protection snapshot captured and path recorded.
- [ ] **Contract gate**: required-check string exactly `task-linkify-regression-gate`.
- [ ] **Preservation audit gate (new)**: capture current required contexts **verbatim** in evidence *before apply*.

## 2) Command Sequence

### A. Read-only verify (non-mutating)
```bash
./tools/task-linkify-branch-protection-playbook.sh read
```

### B. Guarded apply (mutating, explicit confirmation)
```bash
./tools/task-linkify-branch-protection-playbook.sh apply
```

### C. Post-apply verify
```bash
./tools/task-linkify-branch-protection-playbook.sh read
```

## 3) Verification Matrix (expected vs actual)

| Check | Expected | Actual | Pass/Fail |
|---|---|---|---|
| `strict` | `true` |  |  |
| Required contexts (pre) | captured verbatim |  |  |
| Required contexts (post) | pre-contexts preserved + target check present |  |  |
| Contains `task-linkify-regression-gate` | yes |  |  |
| Context clobber | none |  |  |
| PR check visibility | appears with exact contract string |  |  |
| Artifact linkage | `task-linkify-regression-output` tied to run id, non-expired, non-zero |  |  |

## 4) Rollback Policy

### Primary rollback (default)
```bash
./tools/task-linkify-branch-protection-playbook.sh rollback-restore <backup-json-path>
```

### Emergency rollback (temporary degraded mode only)
```bash
./tools/task-linkify-branch-protection-playbook.sh rollback-temporary-degraded
```
- Temporary/scoped only for urgent unblock.
- Must be followed by restore/re-apply to intended protection state.

## 5) Rollback Trigger Conditions

- Merge blockage outside expected check contract behavior.
- Required contexts missing/clobbered after apply.
- `strict` mismatch after apply.
- Verification matrix fails any mandatory row.

## 6) Signoff Block

- Operator:
- Reviewer:
- Timestamp (UTC):
- PR number:
- Run id:
- Run URL:
- Backup snapshot path:
- Decision: (promote / hold / rollback)
- Notes:
