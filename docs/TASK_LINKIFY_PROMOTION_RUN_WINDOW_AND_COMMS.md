# Task-Linkify Promotion Run Window + Communications Packet

Task: `task-1771075439409-394w9pwdk`
Required check contract: `task-linkify-regression-gate`

## 1) Run Window Plan

### Primary window
- Duration: 30 minutes (controlled)
- Preconditions:
  - operator and reviewer both present
  - no overlapping infra/config deploys
  - rollback path confirmed available

### Fallback window
- Scheduled +24h from primary slot
- Same preconditions and signoff requirements

## 2) Communications Template Set

### A. Pre-change template
- Scope: enable required check `task-linkify-regression-gate` on `main`
- Start time UTC:
- Expected duration:
- Rollback readiness: backup restore path validated

### B. In-progress template
- Current checklist step:
- **MUTATION=true/false** (mandatory hard field)
- Interim verification status:
- Next checkpoint ETA:

### C. Complete template
- Completion timestamp UTC:
- PR number + URL:
- Run id + URL:
- Check confirmation: `task-linkify-regression-gate`
- Artifact confirmation: `task-linkify-regression-output` linked/non-expired/non-zero
- Final decision: GO / HOLD / ROLLBACK

### D. Rollback template
- Rollback trigger:
- Path used: restore / temporary-degraded
- Current protection state:
- Follow-up restore/re-apply ETA:

## 3) Verification Broadcast Checklist
Every update includes:
- check status for `task-linkify-regression-gate`
- artifact linkage proof (`task-linkify-regression-output`, run-id match)
- rollback state (not invoked / restore / temporary-degraded)
- operator/reviewer timestamped signoff status

## 4) Signoff Path
- operator signoff + timestamp_utc
- reviewer signoff + timestamp_utc
- references:
  - backup snapshot path
  - PR URL
  - run URL
  - artifact id/name

## 5) Go/No-Go Criteria

### GO
- preconditions met
- mutation state clearly communicated at each in-progress update
- verification checklist fully satisfied
- dual signoff complete

### NO-GO
- ambiguous mutation status in communications
- missing check/artifact linkage proof
- reviewer unavailable at critical gate
- rollback readiness incomplete
