# task-1772240932502-7cp8b62ca — TEAM-ROLES.yaml REFLECTT_HOME fix

## Bug
CONFIG_PATHS hardcoded to `homedir()/.reflectt/` — ignored REFLECTT_HOME env var.

## Fix
- Import REFLECTT_HOME from config.ts instead of using homedir()
- watchFile now works for newly created config files (removed existsSync guard)

## PR
https://github.com/reflectt/reflectt-node/pull/498
