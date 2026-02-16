# TASK task-1771261069759-tig4cr9xz — TEAM-ROLES.yaml + `/team/roles` API

## Summary
Shipped team-scoped role registry enhancements so assignment consumers can use a machine-readable role matrix from TEAM-ROLES.yaml with routing hints.

## Delivered

### 1) TEAM-ROLES schema expanded (machine-readable routing matrix)
Updated role model to support:
- `description`
- `alwaysRoute[]`
- `neverRoute[]`
- existing `affinityTags[]`, `protectedDomains[]`, `wipCap`

Implemented in:
- `src/assignment.ts` interface + YAML parser
- built-in fallback roles updated with new fields
- `defaults/TEAM-ROLES.yaml` updated with same fields

### 2) `/team/roles` API endpoint added
- Added team-scoped endpoint in `src/server.ts`:
  - `GET /team/roles`
- Returns enriched agent rows + source metadata and registry descriptor:
  - `success`
  - `agents[]` (with WIP + role/routing fields)
  - `config`
  - `roleRegistry` (`source`, `count`, `format=TEAM-ROLES.yaml`)
- Preserved `GET /agents/roles` for backward compatibility.

### 3) Test coverage
Updated `tests/api.test.ts` to validate:
- `GET /team/roles` response contract
- optional new role fields (`description`, `alwaysRoute`, `neverRoute`) when present

## Files changed
- `src/assignment.ts`
- `src/server.ts`
- `defaults/TEAM-ROLES.yaml`
- `tests/api.test.ts`

## Verification
- Build-only verification (no localhost:4445 test execution):
```bash
npm run -s build
```
- Targeted API test assertions added for `/team/roles` and role field shape.

## Notes
- This aligns with architecture decision: team routing config remains externalized and editable via `~/.reflectt/TEAM-ROLES.yaml`.
- `reflectt init` bootstrap flow can now seed richer role metadata without hardcoding assignment logic in code paths.
