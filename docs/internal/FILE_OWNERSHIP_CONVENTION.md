# File Ownership Convention

## Problem

When multiple agents work on overlapping files in the same sprint, we get duplicate work and merge conflicts (e.g., PR #77 and PR #78 both shipping `src/cloud.ts`). This wastes review cycles and risks regressions.

## Solution: Two layers

### 1. CODEOWNERS (GitHub-enforced)

Both repos have `.github/CODEOWNERS` files. GitHub auto-requests reviewers when a PR touches owned files. This catches overlap at PR time.

### 2. `files_touched` on tasks (convention-enforced)

When creating or claiming a task, declare which key files you expect to modify:

```json
{
  "title": "feat: wire cloud heartbeat",
  "metadata": {
    "files_touched": ["src/cloud.ts", "src/server.ts", "src/index.ts"]
  }
}
```

Before starting work, agents should check the board for other `doing` tasks that touch the same files:

```bash
curl -s http://127.0.0.1:4445/tasks?status=doing | jq '.tasks[].metadata.files_touched'
```

If overlap is found, coordinate in #general before coding.

## Rules

1. **Declare files upfront** — When moving a task to `doing`, add `metadata.files_touched` with the key files you'll modify.
2. **Check for conflicts** — Before starting, scan other `doing` tasks for file overlap.
3. **Coordinate, don't race** — If two tasks need the same file, agents should agree on merge order in #general.
4. **Rebase, don't duplicate** — If your PR overlaps with a merged PR, rebase onto main. Don't re-implement what landed.

## CODEOWNERS scope

| Repo | File |
|------|------|
| reflectt-node | `.github/CODEOWNERS` |
| reflectt-cloud | `.github/CODEOWNERS` |

Global reviewers: `@ryancampbell`, `@itskai-dev`

Core files (server.ts, cloud.ts, cli.ts, tasks.ts) require review from global owners.

## Quick reference

| Situation | Action |
|-----------|--------|
| Starting a task | Add `files_touched` to task metadata |
| File overlap with another doing task | Post in #general, agree on merge order |
| PR overlaps with already-merged PR | Rebase onto main, drop duplicate changes |
| New core file created | Add it to CODEOWNERS |
