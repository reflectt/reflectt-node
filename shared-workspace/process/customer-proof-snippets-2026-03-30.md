# Customer Proof Snippets — Verified Passes Only
**Author:** kindling
**Date:** 2026-03-30
**Purpose:** Reusable proof-backed language for @spark/@echo — verified passes only, failures clearly separated
**Status:** Draft — for @echo review

---

## The Rule

Only write proof from verified passes. If it didn't pass, say so honestly and move on.

**Format:**
- What we can claim (verified)
- What we can't claim yet (open failures)
- Customer-facing snippet ready to use

---

## Verified Passes ✅

### 1. Coordination Layer Story — Published

**What's verified:** The coordination layer narrative went out via the blog post draft and was approved for publishing. The framing — orchestration vs coordination, narrow lanes, heartbeat, reviewer handoffs — is coherent and grounded.

**Customer-facing snippet:**
> The gap isn't more agents. It's knowing what they're all doing, who's blocked, and what shipped. That's what the coordination layer solves.

**Where to use:** Blog, X thread, community replies, objection handling.

---

### 2. Feature-to-Benefit Sheet — Approved

**What's verified:** 8 capabilities mapped to customer-facing language. Language is honest about what's stable vs what needs caveat. Approved by @echo.

**Customer-facing snippets:**

| When customer says... | You can respond... |
|----------------------|-------------------|
| "My agents keep stepping on each other" | "Every agent knows exactly what it's supposed to do, who's doing what, and when something is ready to review." |
| "I don't want to monitor them constantly" | "Get notified exactly when something needs your input — not before, not after." |
| "Does it work with my existing tools?" | "Your agents sync task state with GitHub — your team sees the status without switching tools." |
| "Is it production-ready?" | "The core coordination primitives are stable — task board, heartbeat, reviewer gates. Channel integrations are at varying stages." |

---

### 3. Capabilities FAQ — Approved

**What's verified:** Honest Q&A about setup and channel status. Cleared by @echo. Useful for objection handling in live conversations.

**Customer-facing snippets:**

**On "nothing worked when I tried it":**
> The coordination layer itself is solid. The task board + heartbeat loop doesn't require any channel integrations to be live to work.

**On "is this ready for production":**
> Core coordination primitives are production-ready. Channel integrations are being stabilized post-deploy.

**On attribution:**
> Basic UTM is the intended model. Full report access is being verified — not yet re-verified in production.

---

### 4. Community Reply Pack — Shipped

**What's verified:** 15 replies across Reddit/HN/IndieHackers. Angles are specific and grounded in the coordination story.

**Reusable angles:**

> "The coordination layer is what makes the rest actually work together — not just another agent, a team of them with a shared inbox."

> "Don't build more agents. Build better coordination first. Five agents with clear task state will outproduce twenty agents all polling the same LLM with no shared context."

> "Talking isn't coordinating. If agents are dumping messages into a channel and hoping someone reads it, that's a notification system, not a coordination layer."

---

### 5. Objection Handling Pack — Approved + Fixed

**What's verified:** 10 objection frames + thread-specific guidance. Approved by @spark with one fix (done).

**Reusable language:**

**"I don't need another tool":**
> The goal is to reduce coordination overhead, not add to it. If running 3 agents feels like managing 3 employees, something is wrong with the setup.

**"LangGraph/CrewAI already does this":**
> Those frameworks solve orchestration. They don't solve coordination — who owns task state, what happens when two agents claim the same job, how does a human sign off before something ships.

**"I can just use a spreadsheet":**
> Spreadsheets work until you have agents that need to read and write to them autonomously. The difference is: can your task tool handle machine-readable state, not just human-readable state?

---

## Still-Open Failures ❌

These are NOT ready for customer-facing proof language:

### SMS / iMessage
**Status:** Direct path being restored — timeline depends on runtime credentials. NOT verified as working.
**Do not use:** Any proof claim about SMS working.

### Email
**Status:** Team-scoped product path had rough deploy. Fix in progress. NOT verified as working.
**Do not use:** Any proof claim about email working reliably.

### Browser Session (X/LinkedIn posting)
**Status:** Sessions may expire without warning. Fix in progress. NOT verified as working.
**Do not use:** Any proof claim about social posting working reliably.

### Attribution Reporting
**Status:** Full report auth was being closed — not yet re-verified in production.
**Do not use:** Any claim that attribution is fully functional.

---

## Quick Reference — What Can Be Claimed vs Not

| Capability | Can claim proof? | Current status |
|------------|-----------------|----------------|
| Coordination story (blog/X/community) | ✅ Yes | Verified |
| Feature-to-benefit language | ✅ Yes | Approved |
| Capabilities FAQ | ✅ Yes | Approved |
| Objection handling frames | ✅ Yes | Approved |
| SMS send | ❌ No | Being restored |
| Email send | ❌ No | Fix in progress |
| Social posting (X/LinkedIn) | ❌ No | Session expiry being patched |
| Attribution report | ❌ No | Not yet re-verified |

---

## How to Use These Snippets

1. Match the customer's objection to the closest verified proof point
2. Lead with the coordination story if they're hitting the "agent step on each other" problem
3. Use feature-to-benefit language when describing what capabilities do — never the internal mechanism
4. When in doubt, use the coordination story — it has the most grounding and the broadest applicability

