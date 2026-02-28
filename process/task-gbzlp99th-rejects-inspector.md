# task-1772239190192-gbzlp99th — Task-Comment Rejects Inspector

## Summary
Auth-gated admin endpoint for debugging phantom task-comment emitters.

## Endpoint
`GET /admin/task-comment-rejects?limit=50&reason=task_not_found&author=link&since=<ts>`

## Response Shape
- `reject_id` — unique reject ID
- `timestamp` — when the reject was recorded
- `target_task_id` — the task ID that was attempted
- `invalid_task_refs[]` — suggested similar IDs
- `provenance` — `{integration, original_message_id, sender_id}`
- `content_preview` — first 200 chars of the comment content

## Auth
Loopback-only (localhost). No token needed.

## PR
https://github.com/reflectt/reflectt-node/pull/496
