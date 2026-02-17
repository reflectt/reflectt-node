# Task: Host Provisioning
**ID**: task-1771258255780-718dfmxr4
**PR**: https://github.com/reflectt/reflectt-node/pull/143
**Branch**: link/task-718dfmxr4
**Commit**: 3652a06

## Summary
Full host provisioning state machine connecting reflectt-node to cloud.

## Changes
- `src/provisioning.ts` (420 lines) — ProvisioningManager
- `src/server.ts` — 7 new /provisioning/* routes
- `docs/architecture/host-provisioning.md`
- `public/docs.md` — route docs updated

## Test Proof
- tsc --noEmit: clean
- Route-docs contract: 141/141
- Tests: 122/122 pass

## Known Caveats
- Cloud config/secrets/webhooks endpoints not yet implemented — provisioning gracefully skips (404 handling)
- GET /secrets/:name returns plaintext over HTTP (localhost-only, needs auth+TLS for external)
