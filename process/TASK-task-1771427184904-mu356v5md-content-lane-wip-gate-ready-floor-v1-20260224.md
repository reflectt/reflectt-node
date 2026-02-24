# Content Lane: WIP Gate + Ready Floor + Compliance Reporting (v1)

Task: task-1771427184904-mu356v5md  
Owner: @echo  
Reviewer: @sage  
Date: 2026-02-24 (PT)

## Why this exists
Content throughput collapses when we:
- start too many copy tasks at once (WIP creep), or
- start new work without a clear reviewer path, or
- let the queue drain to 0 “ready-to-pick-up” items.

This doc defines an operational gate + a measurable ready floor.

---

## Definitions (must be unambiguous)

### WIP (Echo)
Count of tasks assigned to `echo` with status `doing`.

### “Ready” task (Echo)
A task in `todo` assigned to `echo` that has:
1) reviewer assigned,
2) explicit done criteria,
3) an intended v0 artifact path (even if not written yet),
4) a clear reviewer ask (blocking-only vs full review).

### Ready floor
**Ready count >= 2** during active hours.

### Active hours
Local PT: **09:00–17:00**.

---

## Rule 1 — WIP gate (hard stop)

**No new task may be started** (moved to `doing`) unless all are true:
1) **WIP <= 1** (Echo can have at most 1 active doing task).
2) **Ready floor remains >= 2** after start.
3) Task has a **reviewer path**:
   - reviewer is assigned, and
   - review request type is specified: `blocking-only` or `full`.
4) Task kickoff comment includes:
   - `started_at`
   - v0 ETA (<=45m)
   - v1 ETA (same-day)

Exception allowed only if:
- it unblocks a launch-critical item **today**, and
- exception is documented in task comment with owner + ETA.

---

## Rule 2 — Ready floor enforcement

At all times during active hours maintain at least **two** `todo` tasks that satisfy “Ready” definition.

If ready floor drops below 2:
1) stop starting new work,
2) convert the next highest priority `todo` tasks into “Ready” by:
   - assigning reviewer,
   - adding an intended artifact path,
   - posting the reviewer ask.

---

## Rule 3 — Compliance reporting (twice daily)

Post a compliance update **twice daily**:
- **09:00 PT** (AM check)
- **14:00 PT** (PM check)

Where to post:
- primary: task comments on `task-1771427184904-mu356v5md`

Format (must be copy/paste consistent):
- Ready floor: `<n>/2` (list task IDs)
- WIP: `<n>` (list doing tasks)
- Breach? `Y/N`
- If breach: recovery plan (owner + ETA + exact action)

---

## Initial ready queue seed (as of 2026-02-24 02:06 PT)

Ready candidates (in `todo`, assigned echo):
- `task-1771411389743-83cm7ra2f` (reviewer: sage) — approvals+canvas parity decision memo
- `task-1771427266820-xs90rmg2o` (reviewer: sage) — retro capture (possible duplicate of this task; keep as ready until reviewer resolves)

WIP (doing):
- `task-1771427184904-mu356v5md`

Ready floor status: **2/2 (seeded)** (pending confirmation that both are kept in `todo` with reviewer path).

---

## Done-criteria mapping

1) Ready floor >=2 enforced during active hours  
→ Defined (Ready + Active hours + enforcement steps) + seeded queue.

2) WIP gate criteria documented and used on new starts  
→ Gate defined; kickoff requirements defined.

3) Twice-daily compliance updates posted  
→ Schedule + required format defined (AM/PM).

4) Any breach includes recovery plan with owner+ETA  
→ Breach handling defined.
