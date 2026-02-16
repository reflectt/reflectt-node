# Focus Mode UX — task-1770951833737-odoyuhfsh

## Summary
Added Focus Mode toggle to the dashboard that highlights the active work lane (doing), collapses noise from stale/paused panels, and shows QA contract details (owner, reviewer, ETA, artifact status) on each task card.

## Changes

### `src/dashboard.ts` (HTML + CSS)
- Added Focus Mode CSS: `.focus-toggle` button, `body.focus-mode` rules
- Active lane emphasis: non-doing kanban columns dim to 30% opacity, doing column expands
- Agent strip: non-active agent cards dim to 25%
- Collapsible panels: Research, Outcome Feed, Compliance, Promotion SSOT get `focus-collapse` class
- Click-to-expand on collapsed panels (temporary override)
- QA contract badge styles: `.qa-contract` with owner/reviewer/ETA/artifact rows
- 🎯 Focus toggle button in header
- Respects `prefers-reduced-motion`

### `public/dashboard.js`
- `toggleFocusMode()`: toggles focus mode, persists to localStorage, re-renders kanban
- `renderQaContract(task)`: renders owner/reviewer/ETA/artifact badge per task card (only in focus mode)
- Focus mode state restored on page load from localStorage
- Click handlers for collapsed panels to temporarily expand

## Done Criteria Verification
1. ✅ Focus Mode toggle supports single active lane emphasis — doing column expands, others dim
2. ✅ Collapsed stale/paused lanes reduce dashboard noise — Research, Outcome, Compliance, SSOT panels collapse
3. ✅ QA contract visible in focus state — owner, reviewer, ETA, artifact status shown per card

## Test Results
- Build: ✅ clean compile
- Tests: 98 passed, 4 pre-existing failures (not related)
- Route-docs: 119/119 ✅
