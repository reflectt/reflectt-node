# Preview Approval Merge Gate — Proof Bundle

Task: `task-1776591790485-ym1a8xz79`
Date: 2026-04-19
PRs: reflectt-node#1251, #1252, #1253, #1254 + reflectt-cloud#2592

## 1) What it does

Prevents agents (genesis) from merging PRs without explicit canvas preview approval.
Two enforcement points:
- `attemptAutoMerge()` in `src/prAutoMerge.ts` — gates the code path
- `scripts/merge-gate-hook.sh` — PreToolUse hook gates `gh pr merge` bash commands

## 2) Approval contract

- Frontend "Looks good" button searches chat history for agent's PR URL
- Sends message: `Previewed "..." (host) — looks good. Please merge PR https://github.com/owner/repo/pull/N.`
- Node extracts repo+PR from the URL → records scoped approval (`owner/repo#N`)
- No wildcard fallback — if no PR URL found, no approval recorded

## 3) Proof runs

### Run 1: Wildcard proof (2026-04-19T10:25Z)
- E2E test: `deploy-state-proof.spec.ts`
- Result: PASSED in 1.6 minutes
- Approval recorded: `*#0` (wildcard — since fixed)
- Genesis merged after "Looks good"

### Run 2: Scoped approval proof (2026-04-19T11:17Z)
- E2E test: `deploy-state-proof.spec.ts` (modified with gate assertions)
- Negative case: approvals before "Looks good" = `[]` (gate blocks)
- Positive case: approval after "Looks good" = `reflectt/staging-preview-test#28`
- Scoped, not wildcard — `*#0` eliminated
- Genesis merged PR #28 after scoped approval

### Evidence (from E2E output)
```
[MergeGate] Approvals BEFORE "Looks good": []
[MergeGate] NEGATIVE CASE PASSED — no approvals before "Looks good"
Clicked "Looks good" — approval sent, genesis will merge
[MergeGate] Approvals AFTER "Looks good": [{"key":"reflectt/staging-preview-test#28","approvedAt":1776596224213,"approver":"user"}]
[MergeGate] SCOPED APPROVAL VERIFIED: reflectt/staging-preview-test#28 (not wildcard)
```

## 4) Code locations

- Gate logic: `src/prAutoMerge.ts:218-224`
- Approval recording: `src/prAutoMerge.ts:61-66`
- Chat detection: `src/server.ts:4609-4630`
- API endpoints: `src/server.ts` — `/merge-gate/check/:owner/:repo/:prNumber`, `/merge-gate/approvals`
- Hook script: `scripts/merge-gate-hook.sh`
- Token endpoint: `src/server.ts` — `/github/token`
- Token refresh: `src/github-cloud-token.ts`
- Frontend: `apps/web/src/app/presence/canvas/chat-panel.tsx` (3 "Looks good" handlers)

## 5) Persistence

Approvals are persisted to `DATA_DIR/merge-gate-approvals.json` (PR #1257).
On startup, approvals are loaded from disk. On each new approval, the file is written.

### Restart survival proof (2026-04-19T11:49Z)
```
# Before restart: approval for reflectt/restart-test#55 recorded
# Node restarted via `flyctl machines restart`
# After restart:
Approvals AFTER restart: [{"key":"reflectt/restart-test#55","approvedAt":1776599345589,"approver":"user"}]
PR 55 still approved: true
PR 56 still blocked: false
```

## 6) Customer-visible honesty (PR #1256)

When an agent posts a PR URL with no preview approval, the node injects:
`"Merge blocked for PR #N — waiting for your approval. Click 'Looks good' when you're ready to merge."`

## 7) Open seams

- [x] Cross-thread isolation — proved, no bleed (PR #1255)
- [x] Customer-visible honesty — system message injected (PR #1256)
- [x] Durable persistence — restart survival proved (PR #1257)
- [ ] Thread-state badge — promote honesty message to first-class UI state (future polish)
