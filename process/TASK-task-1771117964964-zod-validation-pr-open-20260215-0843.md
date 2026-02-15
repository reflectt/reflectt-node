# task-1771117964964 — Zod validation PR open bundle (2026-02-15 08:43 PST)

## Scope in this PR
Converted additional unsafe query parsing sites in `src/server.ts` to explicit Zod validation + structured 400 responses:

- `GET /health/mention-ack/recent`
- `POST /health/idle-nudge/tick`
- `POST /health/cadence-watchdog/tick`
- `POST /health/mention-rescue/tick`
- `GET /health/team/history`
- `GET /logs`
- `GET /release/notes`

Added schemas:
- `MentionAckRecentQuerySchema`
- `HealthTickQuerySchema`
- `HealthHistoryQuerySchema`
- `LogsQuerySchema`
- `ReleaseNotesQuerySchema`

## Validation
```bash
npm run build
# PASS

npx vitest run tests/api.test.ts
# PASS (47 passed)
```

## Notes
- `src/analytics.ts` had unrelated local modifications pre-existing on `main`; excluded from this PR commit.
