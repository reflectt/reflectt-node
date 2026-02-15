# Task Artifact — task-1771182238384-vmici2p86

## Title
feat: dashboard agent cards show active task + PR link

## PR
- https://github.com/reflectt/reflectt-node/pull/72
- commit: ebe43e1

## Shipped
- Dashboard agent cards now display active task title from `/health/team` data
- Added active task ID chip on each card when available
- Added clickable `PR ↗` link on card when `activeTaskPrLink` exists
- Graceful fallback to last-seen text for agents without active tasks
- No new API endpoints; uses existing health payload

## Files
- `public/dashboard.js`
- `src/dashboard.ts`

## Validation
- `npm run -s build` ✅
