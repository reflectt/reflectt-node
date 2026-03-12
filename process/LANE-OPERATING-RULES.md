# Lane Operating Rules

Date: 2026-03-11  
Owner: @harmony  
Context: fix hub-and-spoke execution by making lanes self-driving instead of waiting for @kai to name work.

## Purpose
Each lane must be able to:
1. produce a minimum weekly artifact bar
2. self-generate next work from done criteria
3. distinguish blocked from merely slow

If a lane cannot do those three things, it is not autonomous yet.

---

## Rules for every lane

### 1. Minimum weekly artifact bar
A lane is healthy only if it produces at least one reviewable artifact per week.

Acceptable artifacts:
- PR
- merged spec with linked implementation task(s)
- release-gate doc used by another lane
- dashboard/report with concrete metric output
- runbook/schema doc that unblocks active sprint work

Not acceptable:
- status updates
- agreement messages
- plan-only posts
- “thinking” without a file, diff, or task mutation

### 2. Self-generation rule
When a task is done, the lane must ask:
- what broke during execution?
- what manual step repeated 2+ times?
- what acceptance criterion stayed fuzzy until human intervention?

If the answer exposes recurring friction, the lane creates the next task itself.

Formula:
**done criteria failure or repeated manual step -> next task candidate**

### 3. Blocked vs slow
A lane is **blocked** only when:
- another named owner must provide code/data/decision first
- external service access is missing
- merge/review rights prevent forward motion
- runtime/env issue makes artifact production impossible

A lane is **slow** when:
- the work is hard
- there are multiple tasks in the lane
- the owner is uncertain which slice to do first
- the owner is waiting for “full clarity” before opening a branch

Rule:
If no external dependency exists, the lane is not blocked. It is slow.

### 4. Required blocker format
If blocked, post once with:
- @owner
- exact dependency
- exact artifact or decision needed
- what you will do immediately once unblocked

Without those four elements, it is not a blocker report.

### 5. No abstract updates
Lane communication must include one of:
- owner ask
- gate result
- artifact link
- explicit blocker

Otherwise it should stay unsent.

---

## Lane-specific bars

## Product lane
### Minimum weekly artifact bar
- 1 spec/brief used by implementation
- 1 metric or release-gate definition tied to current sprint

### Self-generation source
- fuzzy acceptance criteria
- repeated review comments about “what good looks like”
- work that required @kai to restate product intent manually

### Blocked threshold
Blocked only if a named decision-maker must choose between two materially different product paths.

---

## Core / execution lane
### Minimum weekly artifact bar
- 1 PR or schema diff tied to sprint gates

### Self-generation source
- repeated manual workflow steps
- missing run state, handoff state, or decision logging
- runtime behavior that depends on chat rather than system state

### Blocked threshold
Blocked only if another lane owns a dependency required for code path completion.

---

## Ops lane
### Minimum weekly artifact bar
- 1 PR or policy artifact affecting release gates, cost controls, or safety checks

### Self-generation source
- recurring manual approval checks
- unclear release decisions
- repeated cost/safety questions that should be policy

### Blocked threshold
Blocked only if the underlying product surface has no hook to enforce policy.

---

## Design lane
### Minimum weekly artifact bar
- 1 shipped component/state set or reviewable UI spec used by implementation

### Self-generation source
- repeated confusion in first-run paths
- missing success/failure states
- implementation teams repeatedly asking what a state should look like

### Blocked threshold
Blocked only if product path is materially undecided.

---

## Growth / content lane
### Minimum weekly artifact bar
- 1 shipped asset or draft linked to a real product state

### Self-generation source
- questions users repeatedly ask in public
- product wins that cannot yet be explained cleanly
- gaps between what shipped and what can be truthfully promoted

### Blocked threshold
Blocked only if product truth is too ambiguous to describe honestly.

---

## Success metrics for v2-agent-operability

## Activation
- Setup time to first working agent: **p50 < 5 min**
- First useful workflow completion rate: tracked per workflow
- Silent day-zero drop-off: tracked

## Trust
- Agent amnesia incidents: count per week
- Wrong-answer-from-missing-context incidents: count per week
- Decision-log coverage on key workflows: percentage
- Time for another agent to inspect a workflow state: **< 1 min**

## Cost
- Cost per agent per day visible
- Soft warning trigger rate tracked
- Hard-stop/downgrade trigger rate tracked
- Silent drop after spend spike tracked

## Workflow operability
- PR attached to run: percentage
- Reviewer routed without chat: percentage
- State visible without chat: percentage
- Handoff completed without human re-explaining context: percentage

---

## Must-pass release gate for operability workflows
A workflow only counts as operable if it passes all of these:
1. PR attaches to run
2. reviewer is routed correctly
3. state is visible without chat
4. events are logged with intent/urgency/owner/rationale
5. another agent can inspect the situation in under one minute

If any item fails, the workflow is not dependable yet.

---

## Closing rule
The lane is healthy when it can create evidence, generate its own next task from friction, and ask for help only with a named owner and a concrete dependency.

That is how we get out of hub-and-spoke and into real autonomous execution.
