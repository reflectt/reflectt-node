# Task Artifact: /insights/top API

**Task:** task-1771955349046-ikbcp9zov
**Title:** Add /insights/top API to surface weekly top pain clusters + task linkage
**Author:** link
**Date:** 2026-02-25

## What Was Done

Added `GET /insights/top` endpoint that aggregates insights by `cluster_key` within a configurable time window and returns the top pain clusters ranked by frequency.

### Endpoint

`GET /insights/top?window=7d&limit=10`

### Parameters

| Param | Default | Description |
|-------|---------|-------------|
| `window` | `7d` | Time window: `Nh`, `Nd`, `Nw` (hours/days/weeks) |
| `limit` | `10` | Max clusters to return (1-50) |

### Response Shape

```json
{
  "clusters": [
    {
      "cluster_key": "runtime::crash::api-server",
      "count": 5,
      "avg_score": 7.6,
      "last_seen_at": 1771987260456,
      "linked_task_ids": ["task-abc", "task-def"]
    }
  ],
  "window": "7d",
  "since": 1771382460456,
  "limit": 10
}
```

### Implementation

- SQL aggregation: `GROUP BY cluster_key` with `COUNT(*)`, `AVG(score)`, `MAX(created_at)`, `GROUP_CONCAT(task_id)`
- Task IDs are deduplicated via `Set`
- Null/empty task_ids excluded from aggregation
- Window parsing supports `h`, `d`, `w` units; defaults to 7d on invalid input
- Limit clamped to [1, 50]

## Files Changed

- `src/server.ts` — New `GET /insights/top` route
- `tests/insights-top.test.ts` — 7 focused regression tests
- `public/docs.md` — Endpoint documentation with example curl + response

## Test Proof

- 1021 passed, 1 skipped (0 failures)
- 7 new tests: shape validation, window parsing (24h, 30d), limit, task_id dedup, ordering, defaults

## Caveats

- Aggregation is post-SQL dedup (GROUP_CONCAT then Set in JS) — fine for typical cluster counts
- Only `created_at` is used for window filtering (not `updated_at`)
