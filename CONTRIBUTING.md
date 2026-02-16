# Contributing (reflectt-node)

## Validating gate: required QA handoff bundle per lane

When moving any task to `validating`, include both:

1. `metadata.artifact_path` (repo-relative under `process/`)
2. `metadata.qa_bundle` with this minimum structure:

```json
{
  "lane": "docs|api|ux|ops|...",
  "summary": "what changed",
  "pr_link": "https://github.com/<org>/<repo>/pull/<id>",
  "commit_shas": ["abc1234"],
  "changed_files": ["path/a", "path/b"],
  "artifact_links": ["process/TASK-...md", "https://..."],
  "checks": ["npm test ...", "curl ..."],
  "screenshot_proof": ["docs/images/example.png", "https://..."]
}
```

If any required field is missing, API should reject `status=validating`.

## Canonical reviewer handoff template

Use:

- `docs/REVIEWER_HANDOFF_BUNDLE_TEMPLATE.md`

for comment-based reviewer handoff.

## Example `PATCH /tasks/:id` to validating

```bash
curl -s -X PATCH "$BASE/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' \
  -d '{
    "status":"validating",
    "metadata":{
      "artifact_path":"process/TASK-proof.md",
      "qa_bundle":{
        "lane":"docs",
        "summary":"Added QA bundle contract docs",
        "pr_link":"https://github.com/reflectt/reflectt-node/pull/123",
        "commit_shas":["abc1234"],
        "changed_files":["CONTRIBUTING.md"],
        "artifact_links":["process/TASK-proof.md"],
        "checks":["npm run -s build"],
        "screenshot_proof":["docs/images/proof.png"]
      }
    },
    "actor":"agent"
  }'
```
