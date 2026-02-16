# TASK task-1771202987453-lze8whfxo — dogfood smoke command (e2e chain)

## Need / bottleneck
We lacked a single CLI command to validate the full cloud enrollment chain in one run, which caused verification drift between registration, heartbeat, API visibility, and dashboard-level confidence.

## Shipped
Added a new CLI command:

```bash
reflectt dogfood smoke --team-id <teamId> --token <bearerToken> [--cloud-url ...] [--dashboard-url ...]
```

### Command behavior
1. Creates one-time host join token (`POST /api/hosts/register-token`)
2. Claims host using join token (`POST /api/hosts/claim`)
3. Sends host heartbeat (`POST /api/hosts/:id/heartbeat`)
4. Verifies cloud sees host (`GET /api/hosts?teamId=...`)
5. Probes dashboard route reachability and confirms source endpoint contains host
6. Prints pass/fail per step and exits non-zero on any failure

## File changed
- `src/cli.ts`

## Verification
- `npm run -s build` ✅
- `node dist/cli.js dogfood smoke --help` ✅

## Notes
- Designed for CI/local dogfood flow with explicit bearer token + team id inputs.
- Keeps failure semantics strict so it can be used as a gate command.
