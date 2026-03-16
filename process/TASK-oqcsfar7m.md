# Task: task-1773603042171-oqcsfar7m — fix(canvas): server-side approval card expiry

## Artifact
PR: https://github.com/reflectt/reflectt-node/pull/1061 (pending)

## Changes
- src/agent-runs.ts:
  - Added `approval_requested`, `approval_approved`, `approval_rejected` to VALID_EVENT_TYPES
  - `submitApprovalDecision`: now handles both `review_requested` AND `approval_requested` events — writes `approval_approved`/`approval_rejected` for agent-action cards (previously only wrote `review_*` types)
  - New `sweepExpiredApprovalCards(ttlMs)`: sweeps undecided approval/review events older than TTL by inserting synthetic rejection events; exported
- src/server.ts: Calls `sweepExpiredApprovalCards()` on startup via lazy import

## AC
- [x] Approval cards do not reappear after node restart when already decided (approval_approved/rejected events written to DB)
- [x] Cards older than TTL (default 24h) swept on node startup (sweepExpiredApprovalCards)
- [x] Existing POST /run-approvals/:id/decide flow unaffected (passes through submitApprovalDecision unchanged for review_requested; now also correct for approval_requested)
