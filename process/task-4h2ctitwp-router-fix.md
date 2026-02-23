# Task: Router fix — author-exclusion must not override role-fit/sole-author fallback

**Task ID:** task-1771874104673-4h2ctitwp  
**PR:** https://github.com/reflectt/reflectt-node/pull/269  
**Branch:** link/task-4h2ctitwp  
**Commit:** 481f4e1  

## Problem

Auto-router over-applies author-exclusion guardrail. When a single-author insight is promoted to a task, the guardrail avoids assigning to the author even when they are the best (or only) role-fit candidate. This caused misrouting: e.g., a CEO-accountability task authored by kai got routed to spark (wrong role) instead of back to kai (correct owner).

Root cause in `resolveAssignment()`: fallback logic picked `nonAuthorCandidates[0]` (first available non-author) regardless of their score, even if they had 0 affinity for the task domain.

## Fix

Added role-fit comparison before applying author-exclusion:

1. **Score comparison**: Compare author's affinity score vs best non-author. If author significantly outscores (>1.5x ratio OR >=0.2 absolute gap), bypass exclusion.
2. **Protected domain bypass**: If author has a protected domain match (e.g., sage for deploy/ci), assign directly without guardrail.
3. **Sole-author fallback**: When author IS assigned (best-fit or sole fallback), `soleAuthorFallback=true` triggers non-author reviewer requirement.
4. **Explicit reason codes**: Every decision now emits `author_exclusion_applied` or `author_exclusion_bypassed` with full context.

## Decision Priority Order (new)
1. Protected domain match on author → bypass, no guardrail
2. Author is best role-fit (score gap) → bypass, require non-author reviewer
3. Viable non-author from scoring engine → apply exclusion
4. Best-scoring non-author candidate → apply exclusion
5. No non-author available → sole fallback to author, require non-author reviewer

## Files Changed
- `src/insight-task-bridge.ts` — +77/-27 lines: role-fit bypass logic in `resolveAssignment()`
- `tests/insight-listener.test.ts` — +149/-1 lines: 3 new test cases

## Test Proof
- 771 tests passed, 1 skipped, 0 failed (44 test files)
- New tests: role-fit bypass, exclusion-applied reason code, protected domain bypass

## Known Caveats
- Score gap thresholds (1.5x / 0.2) are initial values; may need tuning based on real routing data
- Task API remains canonical for assignee; presence signal is secondary (no code change needed — already the case)
