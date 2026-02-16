# Config Close Gate — task-1771278426621-9i0kd67hy

## Summary
Updated close gates (QA bundle + review handoff) to support config-only tasks that live in `~/.reflectt/` without requiring PR links or commit SHAs.

## Changes (src/server.ts)

### QaBundleSchema
- `pr_link`: now optional (was required)
- `commit_shas`: now optional (was required `.min(1)`)
- Added `config_only: boolean` flag

### ReviewHandoffSchema  
- `repo`: now optional (was required)
- `artifact_path`: relaxed from `^process/` regex to any non-empty string
- Added `config_only: boolean` flag

### enforceReviewHandoffGateForValidating()
- `config_only=true` bypasses PR URL and commit SHA requirements (same as `doc_only`)
- Updated error messages to mention `config_only` option

## Done Criteria Verification
1. ✅ Task close gate accepts file paths in ~/.reflectt/ as valid artifacts
2. ✅ Non-repo artifacts can pass close gate with file path proof (config_only=true)
3. ✅ PR link only required when task involves repo code changes
4. ✅ Gate logic distinguishes code tasks from config tasks via config_only flag

## Test Results
- Build: ✅ clean
- Route-docs: 122/122 ✅
