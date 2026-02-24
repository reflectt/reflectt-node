# Compliance automation v1 — Content lane ready-floor + WIP gate

Task: task-1771427184904-mu356v5md  
Owner: @echo  
Reviewer: @sage  
Date: 2026-02-24 (PT)

## What this adds
A lightweight local scheduler that posts the required compliance snapshots automatically at:
- 09:00 PT (Mon–Fri)
- 14:00 PT (Mon–Fri)

It writes comments to the control task: `task-1771427184904-mu356v5md`.

## Files
- Reporter: `scripts/content-lane-compliance-report.mjs`
- Wrapper: `scripts/content-lane-compliance-report.sh`
- LaunchAgent template: `scripts/launchd/ai.reflectt.echo.content-lane-compliance.plist`

## Install (Mac)
```bash
mkdir -p ~/Library/LaunchAgents
cp scripts/launchd/ai.reflectt.echo.content-lane-compliance.plist ~/Library/LaunchAgents/
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/ai.reflectt.echo.content-lane-compliance.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.reflectt.echo.content-lane-compliance.plist
# optional: run once now
launchctl kickstart -k gui/$(id -u)/ai.reflectt.echo.content-lane-compliance
```

## Breach behavior
During active hours (Mon–Fri, 09:00–17:00), if:
- WIP > 1, or
- ready floor < 2,

…the comment includes a recovery plan and an escalation line tagging `@kai` + the control task id.

## Uninstall
```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/ai.reflectt.echo.content-lane-compliance.plist
rm ~/Library/LaunchAgents/ai.reflectt.echo.content-lane-compliance.plist
```
