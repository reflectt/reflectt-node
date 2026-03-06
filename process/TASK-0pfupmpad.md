# TASK-0pfupmpad — Localhost insight cooldown/close endpoints

Task: task-1772810491278-0pfupmpad

## Problem

Operators can end up with stale/noisy insight candidates that should be cooled down or closed, but the existing admin mutation endpoint (`PATCH /insights/:id`) is disabled behind `REFLECTT_ENABLE_INSIGHT_MUTATION_API`.

For day-to-day hygiene, we need a safe **loopback-only** path to cooldown/close an insight without enabling broad mutation.

## Solution

Added narrow localhost-only endpoints:

- `POST /insights/:id/cooldown`
  - requires JSON body: `{ actor, reason }`
  - optional: `notes`, `cooldown_ms`, `cooldown_until`, `cooldown_reason`
  - sets status=`cooldown`
  - defaults cooldown window to **14 days** if not provided

- `POST /insights/:id/close`
  - requires JSON body: `{ actor, reason }`
  - optional: `notes`
  - sets status=`closed`

Security:
- Both endpoints are **loopback-only**.
- If `REFLECTT_INSIGHT_MUTATION_TOKEN` is set, the caller must provide it via `x-reflectt-admin-token` or `Authorization: Bearer ...`.

Audit:
- Both endpoints write to the existing `insight-mutation-audit.jsonl` stream via `recordInsightMutation()`.

## Proof

Tests:

```bash
npx vitest run tests/insight-local-admin.test.ts
```

Covers:
- loopback caller can cooldown/close
- non-loopback caller receives 403

Docs:
- `docs/GETTING-STARTED.md` updated with endpoint usage and token behavior.
