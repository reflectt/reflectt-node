# Session continuity mitigation v1 (repeat-conversation / surprise loop)

**Task:** task-1771878460281-to8bcspiy  
**Owner:** pixel  
**Reviewer:** spark  
**Date:** 2026-02-24

This doc is a **repo copy** of the canonical task artifact:
- `process/TASK-task-1771878460281-to8bcspiy-session-continuity-mitigation-v1-20260224.md`

(also mirrored for local access at `workspace-shared/process/...`).

## Evidence
- Ryan explicitly reports the same “business focus / reflectt loop” conversation repeats multiple times per day with surprise each time.

## Fix (minimal, enforceable)
- **Core Truths canonical:** `process/CORE_TRUTHS_RYAN_v1.md`
- **Ack definition:** task comment (or reflection tied to task) containing literal `ACK CORE_TRUTHS_RYAN_v1`.

## Follow-up (product)
- Optional server-side preflight to warn/block sending to `@ryan` if `core_truths_ack_at` is stale.
