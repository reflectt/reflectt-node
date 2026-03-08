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

Notes:
- Tasks where the reviewer already acted (`review_state=needs_author` or `reviewer_decision` present) should **not** page reviewers. (See PR #806.)

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

## Digest suppression semantics

- `DIGEST_SUPPRESSION_MS` is the cooldown for re-posting an unchanged sweeper digest. Current value: **2 hours**.
- The digest fingerprint is based on the stable set of `type:taskId` pairs only. Changes to rendered copy, titles, or `age_minutes` do **not** create a new digest by themselves.
- Scope is **process-local / in-memory**. The suppression window holds across repeated sweeps in the same runtime, but resets on process restart.
- A genuinely changed finding set (added/removed violation, or a violation changes type) produces a new fingerprint and is emitted immediately.

## Live PR State Check

Periodic sweeps do **not** call `gh pr view` for orphan detection; they rely on task metadata only to avoid blocking the event loop.

Use `/drift-report` when you need live PR-state confirmation. That path may check GitHub state and can distinguish open vs merged/closed PRs.
