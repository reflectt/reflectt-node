# task-1771207809338-qdc9oopx3 — heartbeat contractVersion hotfix (2026-02-16)

## Change
Updated `src/cloud.ts` heartbeat payload to include:

```ts
contractVersion: 'host-heartbeat.v1'
```

## Why
Cloud heartbeat endpoint now validates the `host-heartbeat.v1` contract and rejects payloads missing `contractVersion` with `INVALID_HEARTBEAT_CONTRACT`.

## Validation
- `npm run -s build` (pass)
- CLI still available post-build:
  - `node dist/cli.js host connect --help`

## Expected effect
Automated heartbeat loop from `reflectt-node` should no longer be rejected on missing contract version.
