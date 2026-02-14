# Harness Skeleton — task-1771073728920-1y0ebcpyw

## Exact Regression Cases
1. **click existing**: task-id link for an existing task opens task modal.
2. **click missing**: task-id link for missing task opens explicit not-found modal state.
3. **Enter/Space**: focused task-id link opens modal on keyboard Enter and Space.
4. **collapse non-link**: clicking non-link message body still toggles collapsed/expanded (link click does not).

## Test Command + File Path
- Command: `npm run test:task-linkify:regression`
- Harness file: `tools/task-linkify-regression-harness.ts`
- Output artifact: `artifacts/task-linkify/task-linkify-regression-harness-output.json`

## Pass/Fail Criteria Per Case
- **click existing**: PASS if `.task-id-link` render path exists and click handler routes to `openTaskModal(taskId)`.
- **click missing**: PASS if not-found branch in `openTaskModal` is explicit and disables modal edits.
- **Enter/Space**: PASS if keydown handler supports both `Enter` and `Space` and opens modal.
- **collapse non-link**: PASS if link click path uses stop-propagation and non-link `.msg-content` path toggles collapse.

## CI Run Plan
- **Now**: run as standalone CI step after build.
- **Next step**: promote to required PR check (`test:task-linkify:regression`) in workflow gate.
