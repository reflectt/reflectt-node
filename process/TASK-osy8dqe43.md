# TASK-osy8dqe43: P0 — /overview page crashes on load

## Root Causes
1. Rules-of-hooks violation: useEffect after conditional return
2. verifyUserOwnsHost rejecting all browser users (empty JWT teamIds)
3. Double URL in presence-badge

## Fixes (reflectt-cloud)
753cf531, 09423502, 52936000, c49d7fbd, 7ca32618, f0a8c506

## Verified
Browser-tested overview + canvas. Pixel and kai confirmed.
