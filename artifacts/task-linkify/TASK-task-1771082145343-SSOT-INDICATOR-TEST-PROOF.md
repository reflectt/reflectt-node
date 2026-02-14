# Proof — task-1771082145343-y9mmi4du5 (Deterministic SSOT Indicator Tests)

## Shipped
- Added deterministic regression harness:
  - `tools/ssot-indicator-regression-harness.ts`
- Added npm script:
  - `test:ssot-indicator:regression`

## Coverage Matrix Implemented
1. `resolveSSOTState` deterministic outputs
   - `fresh` (<=24h)
   - `warn` (>24h and <=72h)
   - `stale` (>72h)
   - `unknown` (null timestamp)
   - `unknown` (invalid timestamp)
2. `fetchSSOTMeta` behavior
   - parse success -> extracts `last_verified_utc`
   - parse miss -> `lastVerifiedUtc: null`
   - fetch fail -> `lastVerifiedUtc: null`
   - cache TTL -> second call within window does not refetch
3. URL guard parity
   - URL-embedded token detected inside URL
   - plain token not treated as URL
4. Source guard
   - fixed fallback symbol absent (`SSOT_LAST_VERIFIED_FALLBACK_UTC`)

## Command Evidence
- `npm run test:ssot-indicator:regression` -> **PASS** (12/12)
- `npm run test:task-linkify:regression` -> **PASS** (4/4)
- `npm run build` -> **PASS**

## Result
Deterministic regression coverage is now in place for SSOT indicator state logic and fetch-fail unknown behavior, with linkify parity checks still passing.
