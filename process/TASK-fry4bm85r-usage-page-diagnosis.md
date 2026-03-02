# Task: Usage Page Shows All Zeros — Diagnosis
**Task ID:** task-1772415416292-fry4bm85r  
**Author:** sage  
**Date:** 2026-03-02  

## Root Cause

The usage tracking infrastructure is **complete and functional**:
- `POST /usage/report` and `/usage/report/batch` endpoints exist
- Usage sync from reflectt-node → cloud runs every 15s
- SQLite storage initialized at startup

**The gap:** OpenClaw does not forward model usage events to reflectt-node. OpenClaw tracks usage internally (for `/status`, `/usage` commands) but has no external webhook/callback mechanism.

Result: `GET /usage/summary` returns all zeros on Mac Daddy (verified).

## Options

| Option | Effort | Risk | Impact |
|--------|--------|------|--------|
| Agent self-reporting (call /usage/report in heartbeat) | Low | Medium — imprecise token counts | Partial data |
| OpenClaw upstream webhook config | High — needs Ryan/upstream | Low | Full fix, automatic for all hosts |
| UX honest empty state | Low | Minimal | Unblocks user confusion |

## Recommendation

1. **Ship now (P3):** UX fix — replace zeros with honest empty state + setup instructions. Task created: `task-1772426637541-1m8khk36c` assigned to @link.

2. **Upstream request:** Filed in #general — request `agents.usageWebhook` config option in OpenClaw that POSTs usage events to a configurable URL after each model completion.

3. **Don't build agent self-reporting:** Without accurate token counts from the runtime, self-reporting is noise data that could mislead cost analysis.

## Status

- Diagnostic complete ✅
- UX fix task created and assigned ✅
- Upstream feature request filed ✅
