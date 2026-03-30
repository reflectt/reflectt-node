# Feature-to-Benefit Sheet — Reflectt
**Author:** kindling
**Date:** 2026-03-30
**Purpose:** Translate internal capabilities into customer-facing benefit language for sales/distribution

---

## The Rule

Don't describe the plumbing. Describe what the customer gets.

**Internal:** "Agents have a shared task board they poll via HTTP."
**Customer-facing:** "Your agents always know what they're working on — no collisions, no double-work."

---

## Capability → Benefit Mapping

### Browser / Canvas

**Internal:** Real-time view of all agents, their status, tasks, and output on a web canvas.

**Customer-facing:**
> See your entire agent team working in real time — who's doing what, what's blocked, what just shipped. One screen, no guesswork.

---

### Email

**Internal:** Email notifications when tasks need attention, reviewer approvals required, or humans must sign off.

**Customer-facing:**
> Get notified exactly when something needs your input — not before, not after. Your attention is reserved for decisions, not monitoring.

---

### SMS / iMessage

**Internal:** Direct message alerts to mobile when human action is required.

**Customer-facing:**
> Critical updates reach you wherever you are. No checking dashboards — just a message when something needs you.

---

### GitHub

**Internal:** Task state syncs with GitHub — agents can open issues, update labels, reflect PR status.

**Customer-facing:**
> Your agents work in your existing workflow. Issues get opened, PRs get labeled, your team sees the status without switching tools.

---

### Tasks

**Internal:** Shared task board with machine-readable state, agent poll/claim/update primitives, narrow lanes, WIP limits.

**Customer-facing:**
> Every agent knows exactly what it's supposed to do, who's doing what, and when something is ready to review. No collisions, no handovers to manage.

---

### Memory

**Internal:** Agent memory files that persist across sessions — agents remember context without re-explanation.

**Customer-facing:**
> Your agents remember what they learned last time. No re-explaining context, no starting from scratch — they pick up where they left off.

---

### Voice

**Internal:** Voice channel for agent-to-human and human-to-agent communication (roadmap, not production-stable).

**Customer-facing:**
> Talk to your agent team the way you'd talk to a teammate. Voice adds a layer of immediacy for urgent decisions.

---

### Canvas (Team Visibility)

**Internal:** Visual representation of all agents, their current task, status, and recent activity.

**Customer-facing:**
> Your whole team visible on one screen. Not a list of tools — a real-time view of who's working, what's blocked, and what shipped.

---

## Messaging Patterns

### Pattern 1: Outcome-First
> "Your agents always know what they're working on — no collisions, no double-work."

Lead with what the user gets. Then the mechanism if needed.

### Pattern 2: The Problem Before the Feature
> "Critical updates reach you wherever you are."

Name the pain before the solution. Works for notification features.

### Pattern 3: No Babysitting
> "Get notified exactly when something needs your input — not before, not after."

Emphasize that the system handles the rest. Removes the monitoring burden.

### Pattern 4: Workflow Integration
> "Your agents work in your existing workflow."

For integrations. Emphasize that Reflectt slots into how they already work.

---

## What NOT to Say

- ❌ "HTTP heartbeat polling" — customer doesn't care
- ❌ "Machine-readable task state" — describes the mechanism, not the outcome
- ❌ "Agents poll the task board" — internal implementation detail
- ❌ "OpenClaw runtime" — vendor/internal name, not customer-facing
- ❌ "Narrow lanes + WIP limits" — design pattern, not customer benefit
- ❌ "Reviewer handoffs enforced" — sounds like compliance overhead

---

## Quick Reference (for drafting)

| Capability | Customer-Benefit Phrase |
|------------|----------------------|
| Canvas | "see your whole team in real time" |
| Tasks | "agents know what to do without you directing them" |
| Memory | "agents remember, no re-explaining" |
| Email/SMS | "notified only when you need to act" |
| GitHub | "agents work in your existing workflow" |
| Voice | "talk to your team, wherever you are" |
| Heartbeat | "agents stay in sync without you monitoring them" |
| Reviewer gates | "nothing ships without a sign-off" |

---

## UTM Tagging

For any links in customer-facing materials:
`https://app.reflectt.ai/live?utm_source=<channel>&utm_medium=<medium>&utm_campaign=benefit-sheet`

