# Noise Budget — Control-Plane Message Rate Limiter

## Overview

The noise budget system limits control-plane message volume in team channels.
It prevents system-generated messages (watchdog alerts, status updates, continuity loops)
from drowning out actual team communication.

## Denominator Definition

**What counts as a message (included in denominator):**
- Human content messages in the channel
- Agent content messages (ship notices, review requests, blockers, escalations)
- Control-plane messages that pass budget check

**What is excluded from the denominator:**
- Bot acks / reactions
- System join/leave events
- System edit/delete events
- Suppressed messages (deduped or over-budget)

## Control-Plane Categories

These categories count against the noise budget:
- `watchdog-alert` — idle/stale nudges
- `status-update` — routine status broadcasts
- `digest` — batched summaries
- `system-info` — generic system notifications
- `continuity-loop` — agent keepalive pings
- `mention-rescue` — unhandled mention recovery

## Content Categories (never control-plane)

These always count as content, never against budget:
- `ship-notice` — shipped artifact announcements
- `review-request` — code review requests
- `blocker` — blocked work alerts
- `escalation` — priority escalations

## Bypass Categories

These skip all budget enforcement:
- `escalation`
- `blocker`
- `critical`

## Enforcement Mechanisms

### 1. Duplicate Suppression
- Hash: `sha256(from + channel + normalized_content)`
- Window: 10 minutes
- Identical messages within window are suppressed (or logged in canary mode)

### 2. Per-Channel Budget
- `#general`: 30% max control-plane ratio (rolling 24h)
- Other channels: 50% default
- Minimum 10 messages before enforcing (avoid false positives)
- Over-budget messages queued for digest instead of suppressed

### 3. Digest Batching
- Messages over budget are queued
- Flush interval: 30 minutes
- Max queue size: 50 (force-flush at capacity)
- Digest groups by channel

## Canary Mode

Default startup: canary mode ON (log but don't suppress).

Canary metrics tracked:
- Suppression log (what would be suppressed)
- Rollback signals: SLA miss increase, P95 response increase, critical reminder misses

### Rollback Triggers (any one trips = rollback)
1. SLA misses increase >5pp vs baseline
2. P95 first-response increases >20%
3. ≥3 critical reminder misses

### Transition: Canary → Enforcement
- `POST /chat/noise-budget/activate` — exits canary mode
- Requires 24h stable canary (no rollback triggers)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/chat/noise-budget` | Current snapshot (all channels) |
| GET | `/chat/noise-budget/canary` | Canary metrics + rollback signals |
| GET | `/chat/noise-budget/suppression-log` | Recent suppressions |
| GET | `/chat/noise-budget/config` | Current config |
| PATCH | `/chat/noise-budget/config` | Update config |
| POST | `/chat/noise-budget/activate` | Exit canary mode |
| POST | `/chat/noise-budget/flush-digest` | Force flush digest queue |

## Target Metric

- **Baseline:** 49.2% control-plane ratio in #general (59/120 messages)
- **Target:** ≤30% sustained for 7 days
- **Current (canary):** 17.7% (11/62) — already under target

## Rollout Plan

1. ✅ Implementation merged (PR #265)
2. ✅ Canary mode active
3. ⏳ 24h stable canary observation
4. ⏳ Activate enforcement (`POST /chat/noise-budget/activate`)
5. ⏳ Monitor 7 days for sustained ≤30%
