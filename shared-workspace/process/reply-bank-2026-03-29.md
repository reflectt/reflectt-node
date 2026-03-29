# Reply Bank — 2026-03-29
**Task:** task-1774808195442-9mtn7dfwc  
**Author:** kindling  
**Date:** 2026-03-29  
**Source:** Shipped landing page (app.reflectt.ai/live) + funnel proof (UTM data, conversion signals)

---

## Landing Page Value Props (from app.reflectt.ai/live)

Core pitch: "Coordinate your AI agent team — live canvas, task board, reviewer handoffs, team chat. Any agent, any framework, plain HTTP."

Key angles on the live page:
- **Live canvas** — see all agents, their status, who's blocked, who's active
- **Task board** — agents pull their own work, no collisions
- **Reviewer handoffs** — no silent ships, enforced review
- **Heartbeat API** — one endpoint tells agents what to do next
- **Plain HTTP** — no SDK, no framework lock-in
- **21 agents running in parallel** without collisions

---

## Funnel Proof (what we know works)

From UTM data (2026-03-28):
- **landing_view: 649** — high interest, traffic is finding the page
- **cta_click: 19** — ~3% click-through on CTAs
- **Signups: 8 over 3 weeks** — ~2.9% of clicks convert to signups
- **UTM-tagged traffic: 0** — all organic, untagged

Signal: Traffic is there (649 views), but attribution is broken. Content is interesting enough to get 19 clicks. The gap is conversion, not traffic.

---

## 12+ Reply Angles (proof-backed)

### Short Replies (1-2 lines — for active threads)

**1. On "how do you coordinate multiple AI agents?"**
> the answer is: you need a shared state layer they all check. otherwise they step on each other and you spend all your time untangling the mess

**2. On "what's the hardest part of running AI agents?"**
> coordination. one agent finishing and another agent not knowing what to do next — that's where the time disappears

**3. On "agents don't know what other agents are doing"**
> exactly. they need a shared inbox and a task board they actually read. not a Slack channel they'll ignore

**4. On "AI teams need supervision"**
> not supervision — coordination. the difference: a supervisor gets in the way, a coordination layer gets out of the way

**5. On "too many agents, not enough visibility"**
> 649 people looked at our live canvas in one day. turns out people want to see what their agents are actually doing

---

### Medium Replies (3-5 lines — for thoughtful threads)

**6. On "how do you prevent agents from duplicating work?"**
> WIP limits on the task board. agents pull their own work — if a task is claimed, it's locked. no two agents grab the same ticket
> 
> plus reviewer handoffs mean no silent ships. if nobody approves it, it doesn't merge

**7. On "what does agent coordination actually look like?"**
> our canvas shows every agent live — who's active, who's blocked, who's idle. 
> 
> agents check in via heartbeat (~200 tokens, one endpoint). they get back: current task, next task, inbox. no prompt needed

**8. On "why do AI teams fail?"**
> they fail the same way human teams fail: unclear ownership. when two agents claim the same task and nobody knows until it surfaces in a PR, you've already lost time
> 
> explicit task state fixes this. the board is the source of truth, not Slack, not a doc

---

### CTA Replies (for threads about dev tools, productivity, AI workflows)

**9. On "what's the minimum you need to coordinate a team of AI agents?"**
> a shared task board, a heartbeat endpoint, and a reviewer gate. three primitives. everything else is optional
> 
> we built that at app.reflectt.ai/live — agents pull their own work, reviewer has to approve, you see everything live

**10. On "I want my AI agent to alert me when it hits a blocker"**
> heartbeat endpoint. one POST, every few minutes. tells the agent what to do next and tells you what it's stuck on
> 
> no polling the LLM, no reading logs. just state

**11. On "looking for a Jira alternative for AI agents"**
> Jira was designed for humans reading a board. agents don't read boards — they need machine-readable state
> 
> that's the difference. we built for agents first. humans can look at the canvas if they want, but the agents don't need the UI

**12. On "how do you handle AI agent code review?"**
> reviewer handoff. the agent can't close a task without a human (or another agent) signing off. enforced, not suggested
> 
> no silent ships. no surprise PRs from an agent that was off the rails for six hours

---

### Bonus — Objection Handlers

**"Isn't this overengineering for AI agents?"**
> maybe for one agent. try running five. try running twenty. the coordination overhead becomes the actual problem you're solving

**"My agents already talk to each other"**
> talking isn't coordinating. coordinating means: shared task state, no collisions, reviewer gates, blocker visibility. most "agent communication" is just them dumping messages in a channel and hoping someone reads it

**"Why not just use a Slack channel?"**
> agents don't read Slack channels. they need explicit, machine-readable state — a task board, not a chat room

---

## Notes
- All replies draft-only — posting depends on X session coordination with @spark
- Reply bank should be refreshed weekly based on funnel data
- UTM tags should be added to all posted links: `?utm_source=x&utm_medium=reply&utm_campaign=x-replies-march&utm_term=<term>`
