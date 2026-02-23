# Task: BYOH Preflight Checks + Guided Recovery Flow

**Task ID:** task-1771873780448-wo8rhqz9u
**PR:** https://github.com/reflectt/reflectt-node/pull/272
**Branch:** link/task-wo8rhqz9u
**Commit:** 347e3de

## What Was Built
Preflight validation system for BYOH host onboarding with guided recovery.

### 5 Preflight Checks
1. **Node.js version** — requires >= 20.0.0 (with nvm/brew upgrade commands)
2. **Home directory** — REFLECTT_HOME exists and writable (with mkdir/chmod commands)
3. **Port available** — default port not in use (with lsof/alternative port guidance)
4. **Cloud connectivity** — timeout/DNS/HTTP error handling (with curl/ping/proxy guidance)
5. **Auth validation** — token/key format check + cloud validation (with dashboard regeneration steps)

### Recovery UX
Every failed check returns an array of actionable recovery steps — exact commands the user can run. No generic "something went wrong" messages.

### Integration Points
- `GET /preflight` — JSON report with all checks
- `POST /preflight` — with auth credentials for full validation
- `GET /preflight/text` — CLI-friendly formatted output
- Bootstrap CLI: runs preflight before enrollment, exits early with guidance on failure

## Files Changed
- `src/preflight.ts` — 546 lines (all checks + report formatting + test exports)
- `src/server.ts` — +37 lines (3 endpoints)
- `src/cli.ts` — +21 lines (preflight in bootstrap)
- `tests/preflight.test.ts` — 9 tests

## Test Proof
775 passed, 1 skipped, 0 failed (45 test files)

## Caveats
- Cloud auth validation endpoint (`/api/connect/validate`, `/api/auth/validate`) may not exist yet — gracefully degrades to format-only check
- `skipNetwork` option available for air-gapped setups
