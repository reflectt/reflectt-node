# Task: Docker Identity Guard

**Task ID:** task-1772209369219-u5aey0fs9  
**PR:** https://github.com/reflectt/reflectt-node/pull/581  
**Author:** harmony  

## Problem
Docker containers silently inherited cloud credentials when host `~/.reflectt` was volume-mounted, causing identity collisions.

## Solution
- `isDockerIdentityInherited()` guard in `cloud.ts`
- Detects Docker environment + inherited config.json credentials
- Skips cloud integration with warning unless `REFLECTT_INHERIT_IDENTITY=1`
- Warning comment added to `docker-compose.yml`

## Files Changed
- `src/cloud.ts` — identity guard function + integration in `startCloudIntegration()`
- `docker-compose.yml` — warning comment about host mounts
- `tests/docker-identity-guard.test.ts` — 6 tests

## Tests
- 6/6 pass
- No new TypeScript errors
