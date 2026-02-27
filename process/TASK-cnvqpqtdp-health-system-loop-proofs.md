# TASK-cnvqpqtdp — /health/system loop proofs

Goal: new installs can verify (in ~10s) that sweeper/watchdogs/reflection pipeline are actually running.

## What shipped
PR: https://github.com/reflectt/reflectt-node/pull/470

Adds to `GET /health/system`:
- `quietHours.suppressedNow` + `nowMs`
- `sweeper.running` + `lastSweepAt`
- `timers.*.registered` + `lastTickAt` + `lastTickAgeSec`
- `reflectionPipelineHealth` passthrough

## How to verify

```bash
curl -s http://127.0.0.1:4445/health/system
```

Look for:
- `sweeper.running: true`
- `timers.idleNudge.registered: true` and `lastTickAt > 0`

Manual tick (deterministic proof):

```bash
curl -s -X POST "http://127.0.0.1:4445/health/idle-nudge/tick?force=true&dryRun=true"
curl -s -X POST "http://127.0.0.1:4445/health/cadence-watchdog/tick?force=true&dryRun=true"
curl -s -X POST "http://127.0.0.1:4445/health/mention-rescue/tick?force=true&dryRun=true"
```

Re-check `/health/system` — the corresponding `timers.*.lastTickAt` values should update.

## Notes
- Tick timestamps are stored in-memory (reset on restart). This is sufficient for “is it running right now?” onboarding proof.
- If we need persistence across restarts later, we can back these with SQLite (follow-on).
