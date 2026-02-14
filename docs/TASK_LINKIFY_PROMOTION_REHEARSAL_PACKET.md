# Task-Linkify Promotion Rehearsal Packet (Read-Only)

Task: `task-1771075068288-8oqn22791`

## Scope (Non-Mutating Guarantee)
This rehearsal is **read/verify only**.

- Allowed: read-only inspection commands
- Forbidden: any branch-protection mutation (`apply`, `rollback-restore`, `rollback-temporary-degraded`)
- Rehearsal header must include: `MUTATION=false`

## Timed Run Sequence (Read-Only)

### T+00:00 — Auth / Target checks
```bash
gh auth status
gh repo view reflectt/reflectt-node
```
Expected:
- authenticated session present
- repo reachable

### T+01:00 — Branch-protection read snapshot
```bash
./tools/task-linkify-branch-protection-playbook.sh read
```
Expected key outputs:
- `strict=<true|false>`
- `contexts=` block
- `has_required_context=<true|false>` for `task-linkify-regression-gate`
- merged context preview printed

### T+02:30 — Latest workflow run reference
```bash
gh run list --repo reflectt/reflectt-node --workflow idle-nudge-regression.yml --limit 1
```
Expected:
- latest run id/url visible

### T+03:30 — Artifact verification for selected run
```bash
gh api repos/reflectt/reflectt-node/actions/runs/<run_id>/artifacts
```
Expected:
- artifact name `task-linkify-regression-output`
- non-expired
- non-zero size
- associated with same run id

### T+04:30 — Fill verification matrix + signoff
- Complete evidence template fields
- reviewer confirms pass/fail

## Execution-Log Template Fields
For each command, record:
- command
- output excerpt
- pass/fail
- notes

## Verification Matrix (fill from read output)
- strict value
- required contexts pre (verbatim)
- contains `task-linkify-regression-gate`
- merged-context preview includes target check
- run id/url
- artifact name/size/expired/run-id match

## Go-Live Readiness Criteria (Next Cycle)

### GO
- non-mutating rehearsal completed end-to-end
- required check contract visible/stable
- artifact linkage evidence complete
- reviewer signoff complete

### NO-GO / Abort
- missing/renamed required-check context
- ambiguous or incomplete read outputs
- artifact mismatch (missing, expired, size=0, wrong run-id)
- operator uncertainty on command path

## Mock Signoff Block
- operator:
- reviewer:
- timestamp_utc:
- ref (run or PR):
- mutation_performed: no
- decision: rehearsal_pass / rehearsal_fail
- follow-up actions:
