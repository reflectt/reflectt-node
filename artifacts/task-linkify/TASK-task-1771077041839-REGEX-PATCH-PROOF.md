# Regex Patch Proof — task-1771077041839-cacvv8myq

## Issue
QA flagged URL-guard regex regression in dashboard inline script generation:
- whitespace boundary regex in `isTaskTokenInsideUrl` was emitted as `/s/` instead of `/\s/`.

## Fix
- File: `src/dashboard.ts`
- Patched regex literals in template-script source to preserve `\s` in served JS:
  - `!/\\s/.test(...)` in both segment boundary scans.

## Verification
1. Build + restart completed.
2. Served dashboard source now shows:
   - `!/\s/.test(...)`
3. Runtime checks in browser:
   - `isTaskTokenInsideUrl("... task-...", start,end)` -> `false` (non-URL token)
   - `isTaskTokenInsideUrl("https://.../task-foo", start,end)` -> `true` (URL token)
4. SSOT card parity check remained intact:
   - `ssotCount = 6/7 links`

## Result
Regression fixed and URL-guard behavior restored without breaking SSOT card behavior.
