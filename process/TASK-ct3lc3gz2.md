# Task: One-Click Config + Secrets Export
**ID**: task-1771258271480-ct3lc3gz2
**PR**: https://github.com/reflectt/reflectt-node/pull/146
**Branch**: link/task-ct3lc3gz2
**Commit**: 705c83f

## Summary
Portability escape hatch: export/import full host config (team files, redacted config, encrypted secrets, webhooks, custom files).

## Test Proof
- tsc --noEmit: clean
- Route-docs contract: 153/153
- Tests: 122/122 pass

## Known Caveats
- Secret import requires manual HMK copy from source host
- Cloud credentials always redacted — re-enrollment required
