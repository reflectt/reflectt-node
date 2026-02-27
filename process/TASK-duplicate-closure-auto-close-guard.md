# Duplicate-closure auto-close guard (canonical refs)

**Task:** task-1772167041800-779arc4rl

## Problem
Some tasks are legitimately closed as **duplicates** (no new code required), but when they’re auto-closed or auto-transitioned without canonical references, reviewers get churny “N/A proof” packets and the validating queue gets noisy.

We already enforce canonical refs during validating-entry, but **server-side auto-close writers** can still attempt to close/transition tasks without passing through interactive precheck flows.

## Contract (required for duplicate closures)
When a task is closed as a duplicate (any of these signals):
- `metadata.auto_close_reason` includes `duplicate`, OR
- `metadata.duplicate_of` present, OR
- `metadata.qa_bundle.lane === "duplicate-closure"`, OR
- `metadata.artifacts` contains `"duplicate:task-..."`, OR
- `metadata.outcome/resolution === "duplicate"`

…it must include canonical references:
- `metadata.duplicate_of` — canonical task id
- `metadata.canonical_pr` — canonical PR URL
- `metadata.canonical_commit` — canonical commit SHA

## Behavior changes
### 1) Central guard (server-side)
`src/duplicateClosureGuard.ts`
- `isDuplicateClosure()` expanded to detect duplicate markers more robustly (including `artifacts: ["duplicate:..."]` and `outcome/resolution`).
- `assertDuplicateClosureHasCanonicalRefs()` enforces the required fields.
- `getDuplicateClosureCanonicalRefError()` helper allows auto-close writers to **preflight** and produce a human-readable reason.

### 2) Auto-close writers now refuse + requeue (instead of churn)
- **executionSweeper** (`src/executionSweeper.ts`)
  - Before auto-closing (reconciled close / drift-repair close), preflight the duplicate closure guard.
  - If missing canonical refs: **requeue validating → todo**, clear review approval fields, and post a notification.

- **prAutoMerge tryAutoCloseTask** (`src/prAutoMerge.ts`)
  - Before auto-closing validating → done, preflight the duplicate closure guard.
  - If missing canonical refs: **requeue validating → todo**, clear review approval fields, log close-gate failure.

- **server review auto-transition** (`src/server.ts`, POST `/tasks/:id/review`)
  - If approving would auto-transition validating → done, preflight the guard.
  - If missing canonical refs: return **409** with a clear error (no partial close).

- **chat approval auto-transition** (`src/chat-approval-detector.ts`)
  - If approval would auto-transition validating → done, preflight the guard.
  - If missing canonical refs: skip auto-close and leave a task comment explaining what to fix.

## Before / After examples
### Before (bad duplicate closure: no canonical refs)
```json
{
  "metadata": {
    "auto_close_reason": "duplicate",
    "duplicate_of": "task-1770000000000-abcdef",
    "auto_closed": true
  }
}
```

Result: churny “N/A proof” packets / confusing validating closures.

### After (good duplicate closure: canonical refs attached)
```json
{
  "metadata": {
    "auto_close_reason": "duplicate",
    "duplicate_of": "task-1770000000000-abcdef",
    "canonical_pr": "https://github.com/reflectt/reflectt-node/pull/123",
    "canonical_commit": "abc1234",
    "auto_closed": true
  }
}
```

### After (auto-close refused)
If the closure is detected as duplicate but refs are missing, server-side writers **refuse to close** and requeue to `todo` with:
- `metadata.auto_close_blocked: true`
- `metadata.auto_close_blocked_reason: <error>`

## Regression test
`tests/duplicate-closure-auto-close-guard.test.ts`
- Closing as duplicate without canonical refs must throw.
- Closing as duplicate with canonical refs succeeds.
