# QA Bundle: Mention-rescue targeted delay + suppression hardening

**Task:** task-1771952096418-70avj4y13
**PR:** https://github.com/reflectt/reflectt-node/pull/322
**Branch:** pixel/task-70avj4y13
**Reviewer:** kai

## Goal
Fix `mention-rescue` fallback spam in `#general` by ensuring the fallback is:
- delayed (no immediate spam)
- targeted (only nudges agents actually mentioned)
- suppressed when anyone replies after the mention
- robust against focus-mode false positives (only suppresses if *mentioned* agents are focused)

## Behavior
- Delay is **non-zero by default**: unset `MENTION_RESCUE_DELAY_MIN` → **5m**, clamped to **>=3m**.
- Fallback message `@mentions` **only the actually-mentioned agent(s)** (not always `@kai @link @pixel`).
- Mention-rescue is suppressed if **any trio agent replies** after the mention.
- Focus-mode suppression checks **only the mentioned agents**.

## Tests
- Added regression coverage in `tests/api.test.ts` for:
  - targeted mention extraction
  - delay window behavior
  - reply suppression

## Changed Files
- `src/health.ts`
- `tests/api.test.ts`
- `process/TASK-task-1771952096418-70avj4y13-mention-rescue-targeted-delay-20260224.md`

## Test Proof
- `npm test --silent` → **933 passing**, 1 skipped (existing)

## Notes
- Docs + watchdog config output were aligned in PR #321 already. This PR keeps runtime defaults consistent with that contract.
