# Sales / DM Proof Blurbs — Verified Passes Only
**Author:** kindling
**Date:** 2026-03-30
**Purpose:** Short proof-backed blurbs for DMs, sales replies, lightweight website/community outreach
**Rule:** Verified passes only. Nothing still failing or unstable.

---

## Verified Blurbs ✅

### For "What's the actual product?"

**Blurb 1:**
> Reflectt is a coordination layer for AI agent workflows — not another agent runtime, not a chatbot. It runs the ops layer between your agents so they don't step on each other.

**Use in:** DM responses, cold outreach, community thread replies

---

### For "Does it actually work?" / "Is it production-ready?"

**Blurb 2:**
> The core coordination primitives (task board, heartbeat, reviewer gates) are in production and stable. Teams use it to run multiple agents without collisions. Channel integrations are being stabilized post-deploy — the coordination layer is what's solid.

**Use in:** Sales DMs, objection handling, community responses

---

### For "My agents keep stepping on each other"

**Blurb 3:**
> That's the coordination problem. Not an agent failure — a system design gap. Narrow lanes + shared task state fixes it before it becomes a habit. Happy to show you what it looks like in practice.

**Use in:** Community thread responses, DM replies to specific complaints

---

### For "Is this just another dashboard?"

**Blurb 4:**
> The difference is machine-readable vs human-readable. Your agents can poll a task board, claim work, and hand off to reviewers autonomously. They can't do that on a dashboard. That's the architectural distinction.

**Use in:** Technical audiences, community threads with "just another tool" pushback

---

### For "I tried it and nothing worked"

**Blurb 5:**
> Fair call-out. The coordination layer itself is solid — that's what the live canvas shows. Channel integrations (how agents reach you and you reach them) had rough edges this week. The core loop works without any channels live. Worth another look if you hit the wall on setup.

**Use in:** DM responses to churned/leavers, community objections

---

### For "How is this different from LangGraph/CrewAI?"

**Blurb 6:**
> Those are orchestrators — they run the pipeline. Reflectt runs the ops layer between pipeline steps. Who's doing what, who's blocked, what needs a human sign-off before it ships. Complementary, not competing.

**Use in:** Technical communities (HN, r/AI_Agents), DM responses to power users

---

### For "What's your use case?" / "Who is this for?"

**Blurb 7:**
> Teams running 2+ agents on related tasks who want agents owning their own work without a human bottleneck. The coordination tax makes sense when managing the workflow becomes harder than doing the work.

**Use in:** Sales DMs, community intros, cold outreach

---

### For "Can it do X?" (specific feature questions)

**Blurb 8 — If X is coordination:**
> Yes — that's exactly what we built. Task state, heartbeat, reviewer handoffs.

**Blurb 9 — If X is a channel integration (SMS/email/social):**
> That's on the channel layer — we're stabilizing those post-deploy. The coordination layer is solid and live. Can tell you what's ready vs what's being patched if useful.

---

### For general cold outreach / first contact

**Blurb 10:**
> We built Reflectt after hitting the coordination wall ourselves — five agents, no shared context, one human doing infrastructure's job. The fix was a shared task board + reviewer handoffs + heartbeat. Works for any agent, any model, any framework.

**Use in:** Cold DMs, community first contact, sales sequences

---

### For website / landing page micro-copy

**Blurb 11:**
> "Your agents know what they're working on, who's doing what, and when something needs your input — not before, not after."
> app.reflectt.ai/live

---

## NOT Ready — Do Not Use ❌

- SMS/iMessage send — being restored
- Email send — fix in progress
- Social posting (X/LinkedIn) — session expiry being patched
- Attribution reporting — not yet re-verified
- Any specific metric claim (X agents, Y signups, Z% improvement) unless verified

---

## Quick Copy-Paste Table

| Situation | Blurb # |
|-----------|---------|
| What's the product? | Blurb 1 |
| Is it production-ready? | Blurb 2 |
| Agents stepping on each other | Blurb 3 |
| Just another dashboard? | Blurb 4 |
| Tried it, nothing worked | Blurb 5 |
| vs LangGraph/CrewAI | Blurb 6 |
| Who's it for? | Blurb 7 |
| Can it do X? (coordination) | Blurb 8 |
| Can it do X? (channel) | Blurb 9 |
| Cold outreach / first contact | Blurb 10 |
| Website micro-copy | Blurb 11 |

---

## UTM for any links

`https://app.reflectt.ai/live?utm_source=sales&utm_medium=dm&utm_campaign=sales-proof&q=blurb`

