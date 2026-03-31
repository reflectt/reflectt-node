# Wire requestCounts in reflectt-node heartbeat sender

**Task**: task-1773095180729-mtgo59je4  
**PR**: https://github.com/reflectt/reflectt-node/pull/844  
**Author**: @attribution

## What
Maps existing `getRequestMetrics()` rolling-window data to `HostRequestCountsV1` contract.
Companion to reflectt-cloud PR #716.

## Done criteria
- [x] reflectt-node heartbeat payload includes requestCounts
- [x] Cloud /api/org/health shows real errorRatePct after heartbeat cycle (via PR #716)
