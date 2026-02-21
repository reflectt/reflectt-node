# Incident: Brave Search API Key Exposure

**Date detected:** 2026-02-21  
**Severity:** credential-exposure (P0)  
**Status:** containment complete, rotation pending  
**Task:** task-1771520453161-8wtd2kym7  
**PR:** #219  

## Summary

A Brave Search API key was committed to the repository in artifact files under `artifacts/idle-nudge/`. The key appeared in commit `0a0fd1654e3f36122af28f203276793ecb40ed3e`.

## Timeline

1. **Detection:** Ryan reported exposed key via chat message.
2. **Containment (PR #219):**
   - Removed secret-bearing artifact files from repo tip.
   - Added `.gitignore` rules to prevent future artifact commits containing secrets.
3. **Rotation:** PENDING — requires manual rotation in Brave Search dashboard.
4. **History scrub:** PENDING — `git filter-branch` or BFG to remove from git history.
5. **Verification:** PENDING — blocked on rotation (need new key active + confirm old key rejected).

## Leak Source

Artifact log files generated during idle-nudge debugging were committed to the repo. These files contained environment variable dumps that included the Brave Search API key.

## Prevention Actions

- [x] `.gitignore` rules added for artifact directories
- [ ] Pre-commit secret scanning hook (e.g., `gitleaks`, `detect-secrets`)
- [ ] CI secret scan workflow (fail on detected secrets in diff)
- [ ] Rotate key in Brave dashboard and update runtime config
- [ ] Scrub key from git history via BFG/filter-repo

## Required Human Actions

1. **Rotate the Brave API key** in the provider dashboard (https://api.search.brave.com/app/dashboard)
2. **Store new key** in secret manager / environment variable (not in repo)
3. **Confirm old key returns 401/403** to verify revocation
4. After rotation + verification, run `git filter-repo` or BFG to scrub the old key from history
