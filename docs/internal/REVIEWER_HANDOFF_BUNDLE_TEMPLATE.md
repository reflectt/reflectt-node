# Reviewer Handoff Bundle Template

Use this exact format when moving a task to `validating`.

## Required fields

- Lane (`docs`, `api`, `ux`, `ops`, etc.)
- Task ID
- PR link
- Commit hash(es)
- Changed files
- Test/verification notes
- Proof artifact path/link
- Screenshot/proof links (UI/API evidence)
- Done criteria → evidence mapping
- Reviewer ask (PASS/FAIL)

## Copy/paste template

```md
### QA Handoff Bundle
- **Lane:** docs | api | ux | ops | ...
- **Task:** task-...
- **PR:** https://github.com/reflectt/reflectt-node/pull/...
- **Branch:** ...
- **Commit(s):** ...
- **Changed files:**
  - path/a
  - path/b
- **Validation/Test notes:**
  - [x] docs render check
  - [x] endpoint smoke test
- **Proof artifact:** process/...md (or PR link)
- **Screenshot/proof links:**
  - path/or/url
- **Done criteria → evidence:**
  1) criteria A → evidence A
  2) criteria B → evidence B
- **Known issues / caveats:** none | ...
- **Reviewer requested:** @name (PASS/FAIL)
```

## Filled example

```md
### QA Handoff Bundle
- **Lane:** docs
- **Task:** task-1771117933679-oowenr85u
- **PR:** https://github.com/reflectt/reflectt-node/pull/14
- **Branch:** echo/tasks-api-quickstart-doc
- **Commit(s):** 29a9a37
- **Changed files:**
  - docs/TASKS_API_QUICKSTART.md
  - public/docs.md
- **Validation/Test notes:**
  - [x] markdown renders
  - [x] docs index link added
- **Proof artifact:** https://github.com/reflectt/reflectt-node/pull/14
- **Screenshot/proof links:**
  - docs/images/tasks-api-quickstart-render.png
- **Done criteria → evidence:**
  1) status table added → TASKS_API_QUICKSTART.md section 2
  2) curl flow included → sections 1-5
- **Known issues / caveats:** /tasks/:id/claim runtime/docs drift captured
- **Reviewer requested:** @kai (PASS/FAIL)
```

## One-liner checklist

`Task | PR | Commit | Files | Tests | Artifact | Criteria→Evidence | Reviewer Ask`
