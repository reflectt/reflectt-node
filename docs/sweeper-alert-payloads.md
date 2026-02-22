# Sweeper Alert Payload Formats

All sweeper alerts include `@assignee`, `@reviewer`, and `task ID` for routing and traceability.

## Violation Types

### `orphan_pr` — PR linked to done task but still open
```json
{
  "taskId": "task-1771616720110-f0d0fsoap",
  "title": "Fix truncation in comment relay",
  "assignee": "link",
  "reviewer": "sage",
  "type": "orphan_pr",
  "age_minutes": 145,
  "message": "🔍 Orphan PR detected: https://github.com/reflectt/reflectt-node/pull/208 linked to done task \"Fix truncation in comment relay\" (task-1771616720110-f0d0fsoap). PR confirmed OPEN — @link close or merge it. @sage — confirm status."
}
```

### `validating_sla` — Task stuck in validating past SLA (30m)
```json
{
  "taskId": "task-abc123",
  "title": "Add insight clustering",
  "assignee": "link",
  "reviewer": "kai",
  "type": "validating_sla",
  "age_minutes": 35,
  "message": "⚠️ SLA breach: \"Add insight clustering\" (task-abc123) in validating 35m. @kai — review needed. @link — ping if blocked."
}
```

### `validating_critical` — Task stuck in validating past critical threshold (60m)
```json
{
  "taskId": "task-abc123",
  "title": "Add insight clustering",
  "assignee": "link",
  "reviewer": "kai",
  "type": "validating_critical",
  "age_minutes": 65,
  "message": "🚨 CRITICAL: \"Add insight clustering\" (task-abc123) stuck in validating for 65m. @kai please review. @link — your PR is blocked."
}
```

### `pr_drift` — PR merged but task still in validating
```json
{
  "taskId": "task-xyz789",
  "title": "Fix auth flow",
  "assignee": "link",
  "reviewer": "sage",
  "type": "pr_drift",
  "age_minutes": 120,
  "message": "📦 PR merged 120m ago but \"Fix auth flow\" (task-xyz789) still in validating. @sage — approve or close. @link — ping if needed."
}
```

## Mention Format

All alerts use `@{agent_name}` format (e.g., `@link`, `@sage`, `@kai`). Falls back to `@unassigned` when no agent is set.

## Live PR State Check

Before emitting `orphan_pr` alerts, the sweeper checks live PR state via `gh pr view`. Only OPEN PRs trigger alerts. Merged and closed PRs are skipped with a dry-run log entry.

Cache: 5-minute TTL per PR URL to avoid GitHub API rate limits.
