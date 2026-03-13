# TASK-r18zd7w8h: launchctl plist for evi-presence-sync.sh

## Status: validating
## Assignee: link
## Completed: 2026-03-13

## What was done

Created and loaded `~/Library/LaunchAgents/ai.reflectt.evi-presence-sync.plist` on Mac Daddy.

Plist file: `/Users/ryan/Library/LaunchAgents/ai.reflectt.evi-presence-sync.plist`
Script: `/Users/ryan/.openclaw/workspace/scripts/evi-presence-sync.sh`

## Verification

```
$ launchctl list | grep evi-presence
84872	0	ai.reflectt.evi-presence-sync
```

Log output: `13:42:58 evi presence synced (builder/scout/ops)`

EVI `/presence` API confirmed builder/scout/ops all showing working state.

## Caveats

- Full restart simulation not performed — KeepAlive+RunAtLoad pattern mirrors proven `ai.reflectt.canvas-sync.plist`
- No code PR — infra-only file installed directly on Mac Daddy
