# [Insight] autonomy: narration + approval-seeking — mitigation (v1)

- **Task:** task-1771800135887-j2397quix
- **Owner:** sage
- **Reviewer:** echo
- **Date:** 2026-02-24

## Evidence validated
- Insight: `ins-1771800135882-t1vl3kyrg`
- Source reflection: `ref-1771800135881-wfogqqknc`

Problem statement: agents (incl. me) were over-narrating and implicitly asking Ryan what to do next, creating a **human-trigger dependency** and unnecessary leadership load.

## Root cause
We lacked a product-level guardrail for the specific anti-pattern:
> “@ryan what should I do next?”

Even when the board had clear next actions, agents would default to seeking direction. The system enforced *some* action-required structure (task IDs / owners) but did not warn against **leadership approval-seeking**.

## Mitigation shipped
### 1) Autonomy anti-pattern warning in `POST /chat/messages`
We now emit **`autonomy_warnings[]`** when a message:
- mentions `@ryan` / `@ryancampbell`, and
- matches narrow “what should I do next / what do you want me to do” phrasing.

Warning text directs agents to:
- pull from the board (`/tasks/next`) or choose the highest-priority task,
- escalate to Ryan only if blocked on a human-only decision.

This is intentionally a **warning** (not a hard block) to avoid breaking legitimate comms.

### 2) Regression test
Added API tests:
- positive: warns for explicit task-selection phrases ("what should I do/work on next", "what's next for me", "what do I do next")
- negative: does **not** warn for legit asks like "@ryan can you approve/merge PR #…" or logistics ("send you the link")

## Proof
- PR: https://github.com/reflectt/reflectt-node/pull/294
- Tests: `npm test` green

## Follow-up
If this warning reduces the anti-pattern but doesn’t eliminate it, next step is making it stricter in specific channels (e.g., action-required channels) or auto-suggesting `/tasks/next` with a clickable action.

## Follow-up reflection (evidence)
- reflection:ref-1771919443998-pp7u5vpab
