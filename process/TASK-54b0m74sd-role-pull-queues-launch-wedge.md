# Role-Based Pull Queues & Launch Wedge Backlog

**Task:** task-1772171459186-54b0m74sd  
**Author:** sage  
**Date:** 2026-02-28

---

## Problem

When the board empties (todo=0, doing=0), agents idle until Kai or Ryan manually assigns work. The system has strong review gates but no default "what to do next" behavior. This creates a dependency on human prompting that doesn't scale.

## Evidence (from operational data)

- Link has completed 21 tasks but currently has **5 blocked P1s** and no active work
- Board empties → Kai posts manual assignments → agents start → board empties again
- Insight-bridge auto-creates tasks but they're investigation-type, not shipping-type
- The validating-only stall (fixed in PR #527) was one symptom of this — agents finish work and have nothing to pull

---

## 1. Role-Based Pull Queues

When your task queue is empty, pull from your default queue **in order**. Don't wait to be assigned.

### Link (Engineering)
1. **Unblock yourself** — check your own blocked tasks, resolve the simplest blocker
2. **Unassigned P1 bugs** — `GET /tasks?status=todo&priority=P1&unassigned=true` filtered to engineering/ops lanes
3. **Review requests** — check if any PR needs a technical review
4. **Tech debt** — test coverage gaps, CI improvements, route parity checks
5. **Propose** — if nothing fits, post a concrete proposal in #general with task ID + ETA

### Pixel (Design)
1. **UI punchlist** — `GET /tasks?status=todo&assignee=pixel` (always has items)
2. **Design review** — check open PRs touching `dashboard.ts` or `*.css` for visual regressions
3. **Screenshot proof** — capture before/after for recently merged UI PRs (review backlog)
4. **Component extraction** — any dashboard section that could be a reusable component
5. **Propose** — post a concrete visual improvement with mockup/screenshot

### Sage (Strategy)
1. **Review queue** — any task in `validating` where I'm reviewer
2. **Blocked task triage** — check all blocked tasks, identify which can be unblocked or closed as stale
3. **Insight validation** — review promoted insights, validate evidence, create tasks if real
4. **Operational analysis** — pull metrics, identify bottlenecks, create tasks for the right owner
5. **Board health** — ensure every agent has at least 1 doing task; if not, investigate why

### Echo (Content)
1. **Content review** — any PR or task needing copy review
2. **Docs gaps** — check recently shipped features for missing/outdated docs
3. **Bootstrap/onboarding copy** — user-facing text that reads like agent instructions
4. **Changelog** — summarize recent PRs into user-facing release notes
5. **Propose** — identify content gaps and post with draft + task ID

### Scout (Research)
1. **Spec completion** — any open spec/PRD tasks
2. **Competitive research** — what are similar tools doing? What can we learn?
3. **User feedback** — aggregate and summarize external user reports
4. **Propose** — research questions that would unblock team decisions

### Rhythm (Ops/Automation)
1. **Board health tasks** — automation gaps in task lifecycle
2. **CI/CD improvements** — test coverage, build speed, deployment reliability
3. **Monitoring gaps** — alerting, health checks, SLA tracking
4. **Propose** — operational improvements with measurable impact

### Kai (Lead)
1. **Unblock others** — review queue, approve PRs, merge decisions
2. **Todo queue health** — ensure every agent has 1-2 ready tasks
3. **External blockers** — GitHub org settings, Vercel config, API keys
4. **Direction** — weekly priorities, product decisions

---

## 2. Launch Wedge Backlog

Ready-to-pull tasks with clear done criteria, metric/proof, and reviewer. Any idle agent should check this list.

### Task 1: Docker bootstrap prompt — user-facing fix
- **ID:** task-1772209369194-4fezxd88c (currently blocked, Link)
- **What:** Fix the "openclaw: not configured" error in Docker bootstrap
- **Metric:** Docker quickstart works end-to-end without manual config
- **Reviewer:** Kai
- **Action needed:** Link to unblock and ship, or reassign if Link is stuck

### Task 2: Node UI sidebar nav + page extraction
- **ID:** task-1772232120104-hmbsdqj3e (todo, Pixel)
- **What:** Extract dashboard sections into navigable pages with sidebar
- **Metric:** User can navigate between task board, insights, chat via sidebar
- **Reviewer:** Kai
- **Action needed:** Pixel to claim and start

### Task 3: Ready-queue engine v1
- **ID:** task-1772233825461-b6et7jh24 (blocked, Rhythm)
- **What:** Auto-maintain N ready tasks per lane with WIP limits
- **Metric:** Board never empties — agents always have something to pull
- **Reviewer:** Harmony
- **Action needed:** Rhythm to unblock and implement

### Task 4: Bootstrap page.tsx (reflectt.ai)
- **ID:** follow-up from task-eovh90f0r investigation
- **What:** Pixel's PR #27 — convert dead route.ts to static page.tsx
- **Metric:** Browser visitors see HTML landing page, not raw markdown
- **Reviewer:** Echo
- **Action needed:** Merge PR #27

### Task 5: Task list default filters
- **ID:** task-1772204292496-w819kkziq (blocked, Link)  
- **What:** Default to open tasks, hide synthetic/test tasks in UI
- **Metric:** Dashboard shows useful tasks by default without manual filtering
- **Reviewer:** Kai
- **Action needed:** Link to unblock

---

## 3. No-Prompt Test Results (Retrospective)

Instead of a formal 48h test, we have **weeks of operational data** showing what triggers prompting vs. organic pull:

### What works without prompting
- **Insight-bridge** auto-creates investigation tasks → agents pick them up via `/tasks/next`
- **Heartbeat loop** keeps agents checking for work every cycle
- **Review requests** trigger reviewer notifications → reviews happen organically
- **Task notifications** (`@agent [taskAssigned:...]`) trigger immediate pickup

### What still requires prompting
1. **Board-empty state** — when todo=0 and doing=0 across all agents, Kai manually assigns. **Fix:** this playbook + ready-queue engine (Task 3 above)
2. **Blocked task accumulation** — blocked tasks pile up without anyone triaging. **Fix:** Sage's pull queue includes blocked-task triage as priority #2
3. **Cross-repo coordination** — e.g., reflectt.ai changes that need reflectt-node awareness. **Fix:** task comments with explicit @mentions
4. **Priority shifts** — when Ryan changes direction, agents don't self-redirect. **Fix:** Kai posts priority updates in #general, agents check before pulling

### Next fix
The ready-queue engine (Task 3) is the highest-leverage automation: it ensures the board never empties by auto-seeding ready tasks from templates or backlog. Combined with this playbook, agents should be able to self-direct for 48h+ without prompting.

---

## How to Use This

1. **Check your queue** — run `/tasks/next?agent=<you>` 
2. **If empty** — follow your role's pull queue above, top to bottom
3. **If all queues empty** — post in #general: "Queue empty, proposing: [concrete next step]"
4. **Never idle silently** — if you have nothing to do, that's a signal to fix, not wait

*Updated: 2026-02-28. This is a living document — update it as roles evolve.*
