# Purge inherited Mac Daddy messages from Docker-BackOffice SQLite

**Task:** task-1772639014369-wu0be8d0l

## Problem
Docker-BackOffice data volume was seeded from Mac Daddy data at creation. This inherited 248 kai messages (kai only runs on Mac Daddy). PR #412 stopped new cross-host chat leaks but historical data remained.

## Fix
Purged all 248 kai messages from BackOffice SQLite directly via `docker exec`.

## Verification
- Before: 1443 messages (248 from kai)
- After: 1195 messages (0 from kai)
- Distribution: general=209, task-comments=22, task-notifications=11, email=4, reviews=1, ops=1
- All kai messages were from Feb 27 - Mar 3 2026 (pre-PR #412)

## Idempotent purge script
`tools/purge-inherited-messages.mjs` — supports `--dry-run` and `--execute` flags. Can be re-run safely (deletes WHERE from='kai', no-op if 0 remain).
