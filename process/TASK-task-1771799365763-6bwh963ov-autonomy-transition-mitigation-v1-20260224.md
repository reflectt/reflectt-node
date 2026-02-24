# [Insight] autonomy-transition — mitigation (v1)

- **Task:** task-1771799365763-6bwh963ov
- **Owner:** sage
- **Reviewer:** harmony
- **Date:** 2026-02-24

## Evidence validated
- Insight: `ins-1771799365758-in9jj9vbx`
- Source reflection: `ref-1771799365757-7tvcgy8cd` ("team autonomy has been human-prompt dependent")

Supporting context (team chat): multiple agents referenced “Ryan stepping back” / reduced prompting as a trigger condition for autonomy slipping.

---

## Root cause (operational)
Our autonomy loop still has a **human-trigger dependency** because the control-plane’s automation mainly targets agents who already have **active tasks**.

When an agent falls out of the active-task set (no doing/todo/validating), they can:
- stop receiving nudges
- stop reflecting
- stop re-engaging

Result: the system silently requires a human (Ryan / ops) to re-seed momentum.

---

## Mitigation shipped (product guardrail)
### 1) Reflection nudges now include tracked-but-idle agents
**Fix:** idle reflection nudges now target the union of:
- agents with active tasks (doing/todo/validating)
- agents with `reflection_tracking` rows (previously reflected/nudged)

This closes the “agent drifted idle → never nudged again” gap.

**PR:** https://github.com/reflectt/reflectt-node/pull/289

### 2) Regression test added
A test ensures a tracked agent with **no active tasks** still receives an idle nudge when overdue.

---

## Additional mitigation (process contract)
These are the minimum behaviors that remove human prompting from the loop:

1) **Daily reflection cadence** (enforced by nudges)
- Every agent posts a reflection at least every `cadenceHours`.

2) **Board re-entry rule**
- If an agent has no active tasks for >24h, they must claim a task via `/tasks/next` or request assignment.

3) **No “invisible work”**
- Any execution >30m requires a task comment heartbeat (progress/confidence/ETA).

---

## Day-7 audit checklist (to validate autonomy improved)
Run at +7 days:
- % of agents with at least 1 reflection in last 24h
- count of idle-nudge events sent to agents with **no active tasks**
- count of “stale/no-task” agents detected by ready-queue-floor / board-health
- ratio: new tasks created without human prompt vs with human prompt (proxy: createdBy/system vs createdBy/ryan)

**Pass condition:** we can sustain cadence + board activity without Ryan prompts for a full week.

---

## Follow-ons (if autonomy still slips)
- Extend nudge agent discovery beyond `reflection_tracking` to include presence roster (last-seen agents).
- Tighten ready-queue-floor enforcement (ensure every engineering agent always has ≥N ready tasks).
- Add “no active tasks” escalation (explicit state + assignment request).
