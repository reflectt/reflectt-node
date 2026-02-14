# Task-Linkify Promotion Day Quickstart (One-Page)

Task: `task-1771075786096-i03t1l933`
Required check contract: `task-linkify-regression-gate`

## 🔴 DO NOT PROCEED IF...
- dual confirmation (operator + reviewer) is missing at pre-mutation gate
- backup snapshot is missing/unreadable
- baseline read capture is missing (`required_contexts_pre` not recorded verbatim)
- check/artifact linkage is mismatched or unclear
- mutation state is ambiguous in active comms update

If any condition is true: **ABORT** and hand off to rollback policy in runbook.

## Minimal Command Flow

### 1) Read-only preflight
```bash
gh auth status
gh repo view reflectt/reflectt-node --json nameWithOwner,defaultBranchRef,url
./tools/task-linkify-branch-protection-playbook.sh read
./tools/task-linkify-promotion-smoke.sh
```

### 2) Gate checks
Confirm all before mutation:
- contract check string is exact
- baseline + backup captured
- reviewer present and ready
- smoke summary has no blocking failures

### 3) Apply (ONLY on dual confirmation)
- Execute guarded apply path from runbook/checklist flow.
- No apply without explicit operator+reviewer confirmation.

## Abort + Rollback Handoff
- **Primary rollback:** restore from backup snapshot (default path)
- **Emergency temporary degraded:** incident-scoped only, then mandatory restore/re-apply

## Required Reference Docs
- Checklist: `docs/TASK_LINKIFY_LIVE_PROMOTION_CHECKLIST_FINAL.md`
- Ledger: `artifacts/task-linkify/TASK-task-1771075286830-EXECUTION-LEDGER-TEMPLATE.md`
- Runbook: `docs/TASK_LINKIFY_REQUIRED_CHECK_RUNBOOK.md`
- Comms packet: `docs/TASK_LINKIFY_PROMOTION_RUN_WINDOW_AND_COMMS.md`
- Smoke script: `tools/task-linkify-promotion-smoke.sh`

## Compact Signoff Checklist
- operator
- reviewer
- timestamp_utc
- refs: backup path, PR URL, run URL, artifact id/name
- decision: GO / HOLD / ROLLBACK
- mutation state at signoff: true / false
