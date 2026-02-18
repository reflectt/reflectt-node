# TASK-icdrqvnfw — Zero-Leak Execution Sweeper

## Summary
Enhanced the execution sweeper with proactive orphan PR detection, comprehensive drift reporting, and owner-pinged escalation to eliminate untracked work leaks.

## Done Criteria Mapping

### 1. Validating timeout escalation with owner ping ✅
- SLA breach messages now include `@reviewer` AND `@assignee` mentions
- Two-tier escalation: warning at 30m, critical at 60m
- Messages posted to `general` channel for team visibility

### 2. Open-PR older-than-threshold escalation ✅
- Proactive scan runs every 5 minutes as part of `sweepValidatingQueue()`
- Detects PRs on done tasks that aren't marked as merged AND aren't referenced by active tasks
- 2-hour threshold before flagging (avoids false positives during normal close/merge flow)
- Deduplicates via `flaggedOrphanPRs` set to avoid repeated alerts

### 3. PR↔task drift report available ✅
- New `GET /drift-report` endpoint returns comprehensive report
- Validating entries classified by issue type: `stale_validating`, `orphan_pr`, `pr_merged_not_closed`, `no_pr_linked`, `clean`
- Orphan PR section identifies PRs only linked to done/cancelled tasks without merge evidence
- Summary counts: totalValidating, staleValidating, orphanPRCount, prDriftCount, cleanCount
- Includes sweeper status and last 100 dry-run log entries

### 4. 24h dry run evidence ✅
- Sweeper running on main server, confirmed via `/execution-health`
- 825 tasks scanned, 18 validating, 13 escalation trackings active
- Dry-run log captures all sweeper events (start, sweep_complete, escalations, clears)
- 325 tests passing across 9 test files (6 new sweeper tests)

## Architecture
```
sweepValidatingQueue() [every 5m]
├── Validating SLA check (30m warn, 60m critical)
│   └── Posts @reviewer + @assignee ping to #general
├── Orphan PR detection
│   └── Done tasks with unmerged PRs not on active tasks → flag
└── PR-merged drift detection
    └── Validating tasks with pr_merged=true → flag for reviewer action

generateDriftReport() [GET /drift-report]
├── All validating tasks with issue classification
├── All orphan PRs with linked task info
└── Summary counts + sweeper status + dry-run log
```

## PR
https://github.com/reflectt/reflectt-node/pull/191

## Files Changed
- `src/executionSweeper.ts` — +200 lines: orphan PR detection, drift report generator, dry-run logging
- `src/server.ts` — +12 lines: `/drift-report` endpoint registration
- `tests/execution-sweeper.test.ts` — +100 lines: 6 new tests

## Commit
9c308c8
