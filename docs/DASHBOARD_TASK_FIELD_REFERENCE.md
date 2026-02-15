# Dashboard Task Field Reference

Versioned: 2026-02-14

This reference documents task payload fields consumed by dashboard task cards/backlog rendering and how null/empty values are handled.

## Primary endpoints

- `GET /tasks`
- `GET /tasks/backlog`
- `GET /tasks/:id`

Dashboard code consumes these fields from task objects.

---

## Field table (task-card relevant)

| Field | Type | Used for | Null/empty behavior |
|---|---|---|---|
| `id` | string | Task identity, modal open, links | Missing ID breaks modal/task-link behavior; treat as invalid payload |
| `title` | string | Card title text | Empty title degrades card readability; UI truncates but does not synthesize fallback title |
| `status` | enum (`todo`,`doing`,`blocked`,`validating`,`done`) | Column placement and status visuals | Unknown/missing status falls back to todo grouping in board logic |
| `priority` | enum (`P0`..`P3`) | Priority badge + sort order | Missing priority treated as `P3` in sorting/default display |
| `assignee` | string | Assignee tag + owner context | Missing/empty assignee shows `unassigned` tag |
| `reviewer` | string | Backlog metadata line | Missing reviewer omitted from backlog metadata text |
| `done_criteria` | string[] | Criteria count + preview in backlog item | Missing/empty list shows `No done criteria listed` fallback |
| `createdAt` | number (epoch ms) | Age ordering and created metadata | Missing timestamp may affect ordering display; avoid null in create flow |
| `updatedAt` | number (epoch ms) | Incremental sync cursor and freshness | Missing value reduces delta sync quality |
| `commentCount` | number | `💬` badge on board/backlog | Missing/zero -> badge hidden; non-zero shows count |
| `blocked_by` | string[] | Dependency semantics (task model) | Not currently rendered directly in task card UI, but used by backend availability logic |
| `metadata` | object | Extended status contract data (`eta`, `artifact_path`, etc.) | Missing fields can block transitions (`doing`,`validating`,`done`) at API gate level |

---

## UI mapping examples

### Example A — complete task card

```json
{
  "id": "task-123",
  "title": "docs: task quickstart",
  "status": "doing",
  "priority": "P1",
  "assignee": "echo",
  "reviewer": "kai",
  "done_criteria": ["doc added", "index link updated"],
  "createdAt": 1771111111111,
  "updatedAt": 1771112222222,
  "commentCount": 2,
  "blocked_by": []
}
```

UI result:
- appears in `doing` column
- shows `P1` badge
- shows assignee `echo`
- shows comment badge `💬 2`

### Example B — sparse backlog item

```json
{
  "id": "task-456",
  "title": "cleanup docs",
  "status": "todo",
  "priority": null,
  "assignee": null,
  "done_criteria": []
}
```

UI result:
- sorted as default `P3`
- displays `unassigned`
- criteria line falls back to `No done criteria listed`
- no comment badge

---

## Edge-case notes

1. `blocked_by` is currently a backend dependency field; card UI does not directly render blocker IDs.
2. `commentCount` is safe to omit when zero; dashboard shows badge only when `> 0`.
3. Missing `status` may produce misleading column placement; keep status explicit in API writes.
4. Null-heavy payloads should be treated as quality issues in task creation, not left for UI recovery.

---

## Operator check

Quick sanity command for field presence:

```bash
curl -s http://127.0.0.1:4445/tasks?limit=5
```

Verify each returned task has at minimum:
- `id`, `title`, `status`, `createdAt`, `updatedAt`
- explicit `assignee` (or intentional null)
- `done_criteria` array
