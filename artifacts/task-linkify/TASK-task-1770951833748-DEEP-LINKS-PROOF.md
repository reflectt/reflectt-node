# Proof — task-1770951833748-0937xox0v (Task-ID Deep Links in Chat/Compliance)

## Implementation Summary
Made task IDs clickable in chat messages and compliance table rows, with hover preview tooltips showing title/status/assignee.

## Changes
- File: `src/dashboard.ts`
- Fixed `TASK_ID_PATTERN` regex template emission (`\b` word boundaries now properly escaped)
- Added hover tooltip CSS (`.task-preview-tooltip`, `.tp-title`, `.tp-meta`)
- Updated `renderMessageContentWithTaskLinks()` to include tooltip with title + status/assignee
- Compliance table task column now uses `renderMessageContentWithTaskLinks()` instead of plain `esc()`
- Added `bindTaskLinkHandlers()` shared click/keyboard handler
- Added `initComplianceInteractions()` wired into refresh cycle
- Compliance body now has click + keyboard (Enter/Space) task-link support

## Validation Evidence
Browser evaluation results:
- `complianceLinks: 2`
- `complianceTooltips: 2`
- `chatLinks: 20`
- `chatTooltips: 20`
- first compliance link: `task-1770948331286-jaciudkp7` with title preview
- first chat link: `task-1770951833748-0937xox0v` with title preview

No-regression checks:
- `test:task-linkify:regression` -> PASS (4/4)
- `test:ssot-indicator:regression` -> PASS (12/12)
- `npm run build` -> PASS
- health/ssot/chat/compliance panels all present

Screenshot proof:
- `MEDIA:/Users/ryan/.openclaw/media/browser/8809e996-eff7-44b0-9aa6-b1a5450f8365.jpg`

## Bonus fix
- `TASK_ID_PATTERN` regex `\b` word boundaries were silently stripped in template emission (emitted as backspace). Fixed with double-escape. This means task-id linkification was partially broken before — now fully functional.

## Accessibility
- Keyboard activation (Enter/Space) works on both chat and compliance task links
- Hover tooltips include text title + status/assignee (not color-only)
- Focus-visible styling retained on links
