# TASK-fp0l0cvaq — Ready-queue floor breach semantics

PR: https://github.com/reflectt/reflectt-node/pull/521

## What changed
- Ready-queue floor warning now distinguishes:
  - **breach (warning)** only when below floor AND agent has **no active work** (doing + validating == 0)
  - **info** when below floor but agent is active (doing/validating > 0)
- Idle escalation now counts validating as active (prevents validating-only false idle)
- Added regression tests for validating-only semantics

## Proof
CI green on PR #521.

## Notes
This is a noise-reduction reliability fix (beta onboarding).