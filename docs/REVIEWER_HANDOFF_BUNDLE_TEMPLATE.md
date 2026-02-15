# Reviewer Handoff Bundle Template

Use this template whenever moving a task to `validating`.

## Required fields (copy/paste)

```md
### Reviewer Handoff Bundle
- Task ID:
- PR:
- Commit(s):
- Changed files:
- Tests run + results:
- Proof artifact path:
- Done criteria mapping (criterion → evidence):
- Known risks / open questions:
- Requested reviewer + ETA:
```

## One-liner checklist

`TaskID · PR · commits · changed-files · test-results · artifact-path · criteria→evidence · reviewer+ETA`

## Filled example

```md
### Reviewer Handoff Bundle
- Task ID: task-1771117933679-oowenr85u
- PR: https://github.com/reflectt/reflectt-node/pull/14
- Commit(s): 1a2b3c4, 5d6e7f8
- Changed files:
  - docs/TASKS_API_QUICKSTART.md
  - public/docs.md
- Tests run + results:
  - npm run build ✅
  - curl /tasks/:id/comments smoke ✅
- Proof artifact path:
  - process/task-1771117933679-tasks-api-quickstart-proof.md
- Done criteria mapping (criterion → evidence):
  - Doc added under /docs with examples → docs/TASKS_API_QUICKSTART.md sections 1-5
  - Includes status-contract table → table in header section
  - Includes one end-to-end curl flow → create→claim→doing→validating→done sequence
  - Linked from API docs index → public/docs.md Quickstarts entry
- Known risks / open questions:
  - Claim endpoint behavior can vary across strict-runtime builds (tracked in docs/KNOWN_ISSUES.md)
- Requested reviewer + ETA:
  - @kai, verdict requested in ~15m
```

## Notes

- If there is no PR yet, state `PR: pending` and include exact local branch/commit hash.
- Keep evidence concrete (paths, command output, endpoint response snippets), not summaries only.
