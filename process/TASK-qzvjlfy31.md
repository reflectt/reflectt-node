# TASK-qzvjlfy31 — Fix review_handoff phantom comment_id + local-only artifacts

**Task:** task-1772974840680-qzvjlfy31

## Problem
We observed tasks moved to **validating** with `metadata.review_handoff.comment_id` pointing at a comment that **does not exist** in `GET /tasks/:id/comments`.

Root cause (confirmed by code): `TaskManager.appendTaskComment()` swallowed DB write errors and still returned a success response to callers, allowing **phantom** comment IDs to be recorded into task metadata.

Second-order issue: review artifacts referenced via local workspace paths aren’t reliably retrievable by reviewers on other hosts.

## Changes shipped in this patch
### 1) Make task comment persistence non-phantom (src/tasks.ts)
- `appendTaskComment()` now writes to SQLite in a single **transaction** (insert + comment_count + updated_at).
- DB failures are **thrown** (not swallowed). The API route will surface a 500 instead of returning a fake comment id.
- JSONL audit log remains **best-effort** (DB is source of truth).

### 2) Treat review_handoff.comment_id as server-authored + self-healing (src/server.ts)
- `ReviewHandoffSchema` now includes optional `comment_id`.
- PATCH `/tasks/:id` strips any caller-supplied `metadata.review_handoff.comment_id` to prevent clients from setting arbitrary ids.
- POST `/tasks/:id/comments`:
  - if `category` is `review_handoff` (or `handoff`) and `metadata.review_handoff` exists, the server **stamps** `review_handoff.comment_id` using the persisted comment id.
- On transition into `validating`, the server tries to **auto-fill/repair** `review_handoff.comment_id` from existing comments (prefers `category=review_handoff`, else latest comment by assignee, else latest comment).
- Validating gate now verifies `review_handoff` exists and that `comment_id` resolves. If no comments exist at all, the server creates a **system** anchor comment and stamps it.

### 3) Canonical artifact paths (blocking local-only paths)
- QA bundle validating gate now enforces:
  - for code tasks, `metadata.artifact_path` and `metadata.qa_bundle.review_packet.artifact_path` must be **process/** (repo-relative) or a **URL**.
- Review handoff validating gate enforces artifact retrievability:
  - URL is accepted as retrievable.
  - Local/shared repo artifact resolution is attempted.
  - GitHub blob fallback is accepted for `process/*` when PR + commit are known.
  - For non-code lanes, the handoff comment itself is treated as the primary artifact (only requires resolvable comment_id).

## How to use (recommended flow)
1) POST the handoff/spec comment:
```json
POST /tasks/:id/comments
{
  "author": "<agent>",
  "category": "review_handoff",
  "content": "...handoff + links + caveats..."
}
```
2) PATCH the task to `validating` with `metadata.review_handoff` set (no need to include comment_id; server will stamp/repair):
```json
PATCH /tasks/:id
{
  "status": "validating",
  "metadata": {
    "review_handoff": {
      "task_id": "task-...",
      "artifact_path": "process/TASK-...md",
      "known_caveats": "...",
      "pr_url": "https://github.com/<owner>/<repo>/pull/<n>",
      "commit_sha": "abcdef123"
    }
  }
}
```

## Test proof
- `npm test` — **1734 passed** (1 skipped)

## Notes / caveats
- Non-code tasks are lenient on artifact retrievability (comment-as-artifact) until a central artifact store exists.
- For code tasks, anything not `process/*` or a URL is rejected at validating.
