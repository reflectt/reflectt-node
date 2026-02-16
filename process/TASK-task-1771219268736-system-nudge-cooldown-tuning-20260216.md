# task-1771219268736 — system nudge cooldown tuning (2026-02-16)

## Summary
Implemented mention-rescue nudge tuning to reduce duplicate system fallback nudges and enforce stronger focus-mode suppression behavior.

## Code changes
- `src/health.ts`
  - Added `MENTION_RESCUE_GLOBAL_COOLDOWN_MIN` (default `5`) to prevent duplicate fallback nudges across near-identical mention bursts.
  - Added `mentionRescueLastAt` runtime state to enforce global rescue cooldown.
  - Changed focus behavior in `runMentionRescueTick` to hard-suppress fallback nudges when **any** trio agent is in focus mode.
  - Kept per-mention cooldown (`MENTION_RESCUE_COOLDOWN_MIN`) for repeated retries on the same mention id.

## Why this addresses done criteria
- **System nudge cooldown increased or made configurable**
  - Added global configurable cooldown (`MENTION_RESCUE_GLOBAL_COOLDOWN_MIN`).
- **No duplicate nudges within 5 minutes of original mention**
  - Default global cooldown set to 5 minutes and applied across mention events.
- **Focus mode suppresses nudges entirely**
  - Mention rescue fallback now suppresses completely if any trio agent has active focus mode.

## Validation
Executed locally in workspace clone:

```bash
npm install
npm run -s build
npm run -s test -- tests/api.test.ts
```

Result:
- build ✅
- tests ✅ (`77 passed`)
