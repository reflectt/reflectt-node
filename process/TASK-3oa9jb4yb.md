# Task: fix(insights): insight-task bridge dedup
Task ID: task-1773587366619
Branch: link/task-366619-bridge-dedup

## Root Cause
- source_reflection stored only reflection_ids[0] (legacy scalar)
- Dedup check only matched scalar — missed same-session insights with different reflection IDs
- No logging of suppressed duplicates in bridge stats

## Fix
1. Added source_reflection_ids array to task metadata (all reflection IDs)
2. findExistingTaskForInsight now checks any overlap in source_reflection_ids (not ≥50%)
3. Backward-compatible: also checks legacy source_reflection scalar
4. Added matchReason to ExistingTaskMatch for audit trail
5. Added suppressedLog to BridgeStats (array of SuppressedDuplicate)
6. Reset includes suppressedLog: []

## Tests
13 new tests in bridge-dedup-reflection-ids.test.ts — all pass
2318 total passing, 3 pre-existing canvas failures
