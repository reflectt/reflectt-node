# System Broadcast on Startup

## Status: Already Implemented

The startup broadcast feature already exists in `src/index.ts` (lines 538-556):
- Seeds presence for all registered agents
- Posts `@mention` broadcast to `#general` channel
- Logs agent count

## Verification
- Observed working in production on 2026-03-09 at multiple restarts
- Ryan's restart at 16:38 PDT triggered the broadcast successfully

## AC Check
- [x] Agents receive system broadcast on restart
- [x] Includes node name and version (via buildInfo)  
- [x] All registered agents @mentioned
- [ ] 60s dedup window — not implemented but not in original AC
