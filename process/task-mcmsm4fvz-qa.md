# QA: Fix mention-rescue duplicate fallback spam

**Task:** task-1771518951373-mcmsm4fvz  
**PR:** #231 (link/mention-rescue-idempotency)  
**Commit:** c6558c1 + TS fix  

## Problem

Mention-rescue watchdog was sending duplicate fallback nudges when Ryan mentioned the same agents in multiple messages within the same thread/channel. Each mention triggered a separate rescue attempt, causing spam.

## Fix: Thread-Level Idempotency

### Before (duplicate spam)
```
[Watchdog] Mention rescue: @link mentioned by Ryan in msg-1 → nudge sent
[Watchdog] Mention rescue: @link mentioned by Ryan in msg-2 (same thread) → nudge sent (DUPLICATE)
[Watchdog] Mention rescue: @link mentioned by Ryan in msg-3 (same thread) → nudge sent (DUPLICATE)
```

### After (thread-level dedup)
```
[Watchdog] Mention rescue: @link mentioned by Ryan in msg-1 → nudge sent
[Watchdog] Mention rescue: @link mentioned by Ryan in msg-2 → SKIPPED (thread already rescued)
[Watchdog] Mention rescue: @link mentioned by Ryan in msg-3 → SKIPPED (thread already rescued)
```

## Implementation

- `buildMentionThreadKey(mention)`: generates composite key from `channel + threadId + sorted(mentionedAgents)`
- `isThreadRescued(key, cooldownMs, now)`: checks SQLite `mention_rescue_log` for recent rescue within cooldown
- `recordThreadRescue(key, now)`: persists rescue event to DB
- `processedThreadKeys` Set: in-memory dedup within single tick cycle
- Per-thread cooldown: configurable, prevents re-rescue of same thread within window

## Test Evidence

- 10 new tests in tests/mention-rescue.test.ts covering:
  - Thread key generation (same thread → same key)
  - Thread key uniqueness (different thread → different key)
  - Duplicate suppression within tick
  - Cross-tick persistence via SQLite
  - Cooldown expiry and re-rescue
  - Stale mention age cutoff
  - Global cooldown between rescues
- 549 total tests pass, tsc clean

## Dry-Run / Live Tick Evidence

Thread key format: `general::thread-abc::kai,link` (channel::threadId::sortedAgents)
- Same channel + same thread + same agents → identical key → deduped
- Different thread or different agents → different key → both processed
- SQLite persistence ensures dedup survives process restart
