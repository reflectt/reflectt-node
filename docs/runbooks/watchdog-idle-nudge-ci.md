# Watchdog Idle-Nudge CI Regression Gate

## Purpose
Prevent laneReason mapping drift in idle-nudge suppression logic from reaching main.

## CI Gate
- Workflow: `.github/workflows/idle-nudge-regression.yml`
- Job: `lane-reason-fixture-gate`
- Trigger conditions:
  - Pull requests touching `src/**`, fixture test, package manifests, or workflow file
  - Pushes to `main` with same path filters
  - Manual run via `workflow_dispatch`

## Gate Command
```bash
npm run test:idle-nudge:fixtures
```

## Pass/Fail Behavior
- **Pass:** command exits `0`, fixture output includes `IDLE_NUDGE_LANE_FIXTURES_PASS`.
- **Fail:** any fixture assertion mismatch exits non-zero; GitHub job fails and blocks merge via required-check policy.

## Triage Steps (laneReason drift)
1. Run locally:
   ```bash
   npm run build
   npm run test:idle-nudge:fixtures
   ```
2. Compare expected vs actual fixture row in output.
3. Inspect resolver: `src/watchdog/idleNudgeLane.ts`.
4. If behavior change is intentional, update fixture expectations and include rationale in PR.
5. Re-run gate command and ensure output is clean before review.
