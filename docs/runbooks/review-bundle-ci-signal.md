# Runbook — Review-bundle CI signal (strict mode)

Strict review-bundles need a reliable “CI green?” signal from GitHub.

## Source of truth (priority order)

1) **GitHub check-runs** (preferred)
- Endpoint: `GET /repos/:owner/:repo/commits/:sha/check-runs`
- Rationale: modern GitHub Actions / required checks are represented as check-runs, and many repos publish **zero** commit statuses.
- Strict evaluation:
  - If any check-run `status != completed` → CI is `pending`
  - If any check-run `conclusion` is failing (`failure/cancelled/timed_out/action_required/stale`) → CI is `failure`
  - If all completed check-runs have `conclusion in { success, neutral, skipped }` → CI is `success`

2) **Combined commit status** (fallback)
- Endpoint: `GET /repos/:owner/:repo/commits/:sha/status`
- Used only if check-runs are unavailable/unreadable.

## Why this exists
We hit a regression where strict review-bundle blocked merges as `ci_not_success:pending` because it used the combined status API which returned `pending` with **0 statuses**, despite all check-runs being green.

## Related code
- `src/server.ts` → `resolvePrAndCi()`
- `src/github-ci.ts` → `computeCiFromCheckRuns()` / `computeCiFromCombinedStatus()`
