# Corrected Seeded Bundle — task-1770916206001-tppfibok0

## Runtime proof
- Enabled PID: `pid-enabled.txt`
- Enabled env proof: `env-enabled.txt` contains `IDLE_NUDGE_ENABLED=true`
- Enabled debug proof: `debug-enabled.json` => `config.enabled=true`

## Seeded run outputs
- Dry run: `tick-dryrun.json`
  - `decisions.length = 1`
  - decision: `agent=link`, `reason=below-warn-threshold`, `idleMinutes=0`
- Real run: `tick-real.json`
  - `decisions.length = 1`
  - decision: `agent=link`, `reason=below-warn-threshold`, `idleMinutes=0`

## Rollback proof
- Rollback PID: `pid-rollback.txt`
- Rollback env proof: `env-rollback.txt` contains `IDLE_NUDGE_ENABLED=false`
- Rollback debug proof: `debug-rollback.json` => `config.enabled=false`

## G1–G6 (current)
- G1 Config gate (`enabled:true`): PASS
- G2 Sub-threshold negatives: PASS (below threshold decision observed)
- G3 Placeholder suppression: PASS (no `<task-id>` leakage)
- G4 Tier behavior warn/escalate evidence: FAIL (no warn/escalate yet)
- G5 Cooldown suppression evidence: FAIL (no eligible nudge path reached)
- G6 Rollback safety: PASS
