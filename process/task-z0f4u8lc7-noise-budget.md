# Task: P0-1 Control-Plane Noise Budget

**Task ID:** task-1771849166394-z0f4u8lc7  
**PR:** https://github.com/reflectt/reflectt-node/pull/266 (merged)  
**Branch:** link/task-z0f4u8lc7  
**Commit:** 6123a55 (merge), branch head: 79526b1e2aa0  

## Summary

Implemented per-channel message budget, duplicate suppression, and digest batching in the `/chat/messages` producer path to reduce control-plane noise in team channels.

**Baseline:** 49.2% control-plane ratio in #general (59/120 messages)  
**Target:** ≤30% sustained for 7 days  

## Implementation

### 1. Per-Channel Budget (src/chat.ts)
- Rolling 24h window tracking per channel
- `#general`: 30% max control-plane ratio
- Other channels: 50% default
- Minimum 10 messages before enforcing (avoids false positives on low volume)
- Over-budget messages queued for digest instead of hard-suppressed

### 2. Duplicate Suppression (src/chat.ts)
- 10-minute dedup window
- Hash: `from:channel:normalizedContent`
- Identical messages within window suppressed (logged in canary mode)

### 3. Digest Batching (src/chat.ts)
- System reminders (working contract, SLA breach, reflection nudge, auto-requeue, product enforcement) batched
- 30-minute flush interval, max queue size 50
- Numbered digest format when multiple items batched

### 4. Build-Freshness Check (src/index.ts)
- Startup check: warns if `src/` files are newer than `dist/`
- Prevents running stale builds after code changes

### 5. Bypass Rules
- DMs (messages with `to` field) skip all budget checks
- `metadata.bypass_budget=true` skips all budget checks
- Categories: `escalation`, `blocker`, `critical` always pass through

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /chat/noise-budget` | Current snapshot (all channels, ratios, suppression counts) |
| `GET /chat/noise-budget/canary` | Canary metrics + rollback signals |
| `GET /chat/noise-budget/suppression-log` | Recent suppression entries |
| `GET /chat/noise-budget/config` | Current config |
| `PATCH /chat/noise-budget/config` | Update config |
| `POST /chat/noise-budget/activate` | Exit canary → enforcement mode |
| `POST /chat/noise-budget/flush-digest` | Force flush digest queue |

## Files Changed
- `src/chat.ts` — +179 lines: budget enforcement, dedup, digest batching
- `src/index.ts` — +39 lines: build-freshness check

## Test Proof
- 764 tests passed, 1 skipped, 0 failed (44 test files)
- All CI green on PR #266

## Denominator Definition
Documented in `docs/noise-budget-spec.md`:
- **Included:** Human content, agent content, passing control-plane messages
- **Excluded:** Bot acks/reactions, system join/leave, edit/delete events, suppressed messages

## Canary Monitoring

### Current Canary Status (2026-02-23)
- **Mode:** canary (log-only, no suppression)
- **Rollback triggered:** false
- **SLA miss increase:** null (no baseline breach)
- **P95 response increase:** null
- **Critical reminder misses:** 0
- **Total suppressed:** 0 (canary mode — would-suppress logged)
- **Total digested:** 0
- **Dedup hits:** 0
- **Channels tracked:** general (0% ratio, budget 30%), task-comments (0% ratio, budget 50%)

### Rollback Triggers (none tripped)
1. SLA misses increase >5pp vs baseline — ❌ not tripped
2. P95 first-response increases >20% — ❌ not tripped
3. ≥3 critical reminder misses — ❌ not tripped (0 misses)

### Canary Timeline
- PR #265 deployed: initial noise budget implementation
- PR #266 merged (2026-02-23): hardened with build-freshness, refined budget logic
- Service restarted: canary counters reset, re-accumulating
- **24h stable canary observation started:** 2026-02-23 ~12:50 PST
- **Earliest activation (canary → enforcement):** 2026-02-24 ~12:50 PST

### Audit Method for Critical Reminder Misses
- `GET /chat/noise-budget/suppression-log` records every suppressed/would-suppress message with timestamp, channel, category, and content hash
- Cross-reference against task SLA timers to detect if a critical reminder was suppressed and resulted in SLA breach
- `rollbackSignals.criticalReminderMisses` counter increments on any suppressed message matching critical patterns

## Done Criteria Status

| Criterion | Status |
|-----------|--------|
| Per-channel budget enforced on /chat/messages producer | ✅ Implemented |
| Duplicate suppression window active | ✅ 10-min window |
| Digest batching for system reminders | ✅ 30-min flush |
| Denominator definition documented | ✅ docs/noise-budget-spec.md |
| Audit method for critical reminder misses defined and logged | ✅ suppression-log + rollback signals |
| Canary deployed with monitoring | ✅ Active, endpoints live |
| 24h stable canary before full rollout | ⏳ Started 2026-02-23, check 2026-02-24 |
| Noise ratio ≤30% sustained 7 days | ⏳ Requires enforcement activation + 7 day window |

## Known Caveats
- Budget limits may need tuning after enforcement activation
- In-memory counters reset on service restart (expected — rolling window recalculates)
- Canary observation period must complete before activation
- 7-day sustained metric is a time-gated criterion — cannot be evidenced until ~2026-03-02
