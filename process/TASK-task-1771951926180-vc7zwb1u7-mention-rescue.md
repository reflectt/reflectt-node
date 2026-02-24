# QA Bundle: De-noise mention-rescue fallback

**Task:** task-1771951926180-vc7zwb1u7
**PR:** https://github.com/reflectt/reflectt-node/pull/321
**Branch:** link/task-vc7zwb1u7-mention-rescue
**Commit:** 865276f
**Reviewer:** kai

## Goal
Stop the immediate “system fallback: mention received…” spam in `#general` while preserving mention-rescue as a true fallback.

## Behavior Changes
- Mention rescue delay now defaults to **5 minutes** (previously could be 0).
- Delay is **clamped to >= 3 minutes** even if `MENTION_RESCUE_DELAY_MIN` is set to `0` or `1`.
- Fallback message only `@mentions` the agents actually mentioned in the triggering message (not the whole trio).
- `/health/watchdog/suppression` now reports the same effective `mentionRescue.delayMin` as runtime.

## Files Changed
- `src/health.ts`
- `src/server.ts`
- `docs/WATCHDOG_BEHAVIOR_EXPLAINER.md`

## Test Proof
- `npm test --silent`
- Result: **930 passing**, 1 skipped (existing)

## Notes
- If we ever want *true* immediate rescue, it should be an explicit opt-in mode (separate env flag) rather than allowing delay=0 via the main delay knob.
