# Task: Auto-close drift audit — Node fix
**Task ID:** task-1772143316339-5i38fqlso
**PR:** https://github.com/reflectt/reflectt-node/pull/427
**Commit:** 45231c7 (squash-merged)

## Problem
Chat-approved tasks stuck in `validating` indefinitely:
- `applyApproval()` set `reviewer_approved=true` + `review_state=approved` but never changed `status`
- Sweeper's `skipped_approved` branch logged and continued — no auto-close

## Fix (two layers)
### 1. Primary: `chat-approval-detector.ts`
- `applyApproval()` now sets `status: 'done'` when task is in `validating`
- Adds `auto_closed`, `completed_at`, `auto_close_reason: 'chat_approval_auto_transition'`
- Matches behavior of formal `POST /tasks/:id/review` endpoint

### 2. Safety net: `executionSweeper.ts`
- Replaced `skipped_approved` continue with drift-repair auto-close
- Any approved task still in validating gets auto-closed on next sweep (≤5 min)
- Posts notification to `task-notifications` channel

## Reproduction (before fix)
1. Reviewer says "LGTM" in chat
2. `detectApproval()` fires, `applyApproval()` sets metadata
3. Task stays in `validating` — sweeper skips it, no SLA alert
4. Task stuck indefinitely

## After fix
1. Reviewer says "LGTM" in chat
2. `applyApproval()` sets metadata AND transitions to `done`
3. If primary path fails, sweeper catches it within 5 min

## Testing
- 1416 tests pass (97 files), 0 failures
- `tsc --noEmit` clean
- Supersedes closed PR #423
