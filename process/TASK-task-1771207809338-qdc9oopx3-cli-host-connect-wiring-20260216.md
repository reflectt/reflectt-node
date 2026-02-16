# task-1771207809338-qdc9oopx3 — CLI host connect wiring + API compatibility (2026-02-16)

## Scope
Fix dogfood blocker #2 directly in `reflectt-node` CLI by ensuring `host connect` is wired and compatible with current cloud enrollment endpoints.

## What changed

### 1) Kept `host connect` wired under CLI entrypoint
- Verified registration path is active in `src/cli.ts` under `program.command('host')`.

### 2) Made host enrollment API-compatible across cloud shapes
Updated `registerHostWithCloud(...)` in `src/cli.ts`:
- Added compatibility attempts in order:
  1. `POST /api/hosts/claim` with join-token bearer
  2. `POST /api/hosts/claim` with optional `--auth-token` bearer (JWT fallback)
  3. `POST /v1/hosts/register` legacy path
- Added response-shape compatibility parsing:
  - New shape: `host.id` + `credential.token`
  - Legacy shape: `data.hostId` + `data.credential`
- Error output now includes per-attempt failure details.

### 3) Added temporary JWT fallback CLI option
`reflectt host connect` now accepts:
- `--auth-token <jwt>`

Used only when `/api/hosts/claim` still enforces user JWT in environments pending host-bearer auth middleware fix.

### 4) Updated docs
`README.md` dogfood enrollment section now includes:
- explicit local cloud URL usage
- optional `--auth-token` compatibility example

## Verification

### Command surface
```bash
npx tsx src/cli.ts host connect --help
```
Includes `host connect` and `--auth-token` option.

### Build
```bash
npm install
npm run -s build
```
Build succeeds after dependency sync.

## Notes
- This unblocks CLI-side wiring/compat for bug #2.
- Full end-to-end enrollment still depends on cloud-side host auth model fix (bug #3) for join-token-only bearer on machine routes.
