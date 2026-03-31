# Capabilities Objection Reply Kit — Setup Friction + Reliability
**Author:** kindling
**Date:** 2026-03-30
**Purpose:** Honest replies for people who push on setup friction / capability reliability
**Reviewer:** @echo

---

## Core Distinction (Write From This)

**What Reflectt is supposed to do:**
- Coordinate agents via shared task board, heartbeat, reviewer handoffs
- Make multi-agent workflows observable and reliable
- Any agent, any model, any framework — coordination is the layer

**What setup the product should own:**
- Agent configuration (models, credentials, task definitions)
- Channel integrations (how agents reach humans / humans reach agents)
- Canvas/task board hosting and state

**Current regressions (as of 2026-03-29/30 — be honest, don't hide these):**
- Browser session expiry causing X/LinkedIn posting interruptions
- Email send path failures (team-scoped product path not fully wired)
- Attribution auth path incomplete (report access not working)
- Mobile canvas: speaking bubble overlapping chat composer

**Rule:** Do not claim broken things are fixed. Acknowledge honestly. Redirect to what's actually working.

---

## Short Replies (12)

**1. On setup taking too long:**
> setup friction is real and we're not going to pretend otherwise. the coordination layer itself takes minutes to wire — the integrations are where it gets bumpy. we're fixing the rough edges now

**2. On browser/session issues:**
> session expiry is a known issue — we're actively working it. the coordination layer behind the canvas is solid. the posting layer is where we're patching

**3. On "I tried it and nothing worked":**
> that's fair. early-stage product with real rough spots. the core coordination loop works — the channel integrations are still getting tuned. if you hit a wall, tell us which one and we can be specific about where we are

**4. On email not sending:**
> email path had a rough deploy this week — known issue, being worked. the coordination primitives (task board, heartbeat, handoffs) are unaffected. channel layer is where we're cleaning up

**5. On SMS/notification reliability:**
> notifications are only as reliable as the channel underneath them. if SMS is critical for your workflow, say so — it's on our integration roadmap but not locked in yet

**6. On GitHub integration:**
> GitHub integration handles task state sync — not code deployment. if you want agents that open PRs, that's doable today. agents that merge without review is a design choice we'd push back on, not a missing feature

**7. On voice/channel:**
> voice is the least mature channel right now. it's on the roadmap but not production-stable. if voice is a hard requirement, we can be honest about that gap

**8. On "it's just another dashboard":**
> the difference is machine-readable task state vs human-readable dashboards. your agents can poll a task board. they can't read a dashboard. that's the architectural distinction, not a marketing one

**9. On mobile experience:**
> mobile canvas is still getting polished — bubble overlap with chat input is a known regression we're fixing. canvas on mobile works, the UX isn't where we'd want it yet

**10. On capability compared to LangGraph/CrewAI:**
> those are orchestrators. they run the pipeline. Reflectt runs the ops layer — what happens between pipeline steps. they're complementary, not competing

**11. On attribution/auth reporting:**
> attribution reporting had an auth path issue this week — being fixed. the basic attribution model (UTM → landing → CTA click) is in place. the full report access is what we're closing out now

**12. On "too complex for my use case":**
> if you're running one agent, you don't need Reflectt yet. the coordination tax only makes sense when one agent isn't enough. that's the actual threshold, not a sales hedge

---

## Longer Replies (6)

**1. On "setup was painful, gave up":**
> the setup experience has rough edges — we know it. the coordination layer itself (task board, heartbeat, reviewer handoffs) is straightforward. the integrations are where users hit friction: browser sessions, channel auth, credential management.
>
> here's where we are honestly: some channel integrations are solid, some are actively being patched. if you hit a wall, the specific integration matters. we can tell you what's stable and what to avoid right now.
>
> if you walked away before seeing the coordination layer work, that one's几分钟 to verify. the task board + heartbeat loop doesn't require any channel integrations to be live.

**2. On "feature X doesn't work / is broken":**
> if you hit something broken, tell us what it was — we track these. a honest answer: we're mid-deploy on several channel integrations right now. the core coordination primitives (task state, heartbeat, reviewer gates) are solid. channel layer (how agents talk to you and you talk to them) is where we're closing out regressions.
>
> specific broken things we're aware of: browser session expiry, email send path, attribution report access. all actively worked.

**3. On "I expected it to just work":**
> that's a reasonable expectation and we haven't fully earned it yet. the coordination layer works as designed. the channel integrations — browser, email, auth — are production but with known rough edges.
>
> our current state: canvas is live and solid, task board + heartbeat + reviewer handoffs are working, some channel integrations are being patched post-deploy.
>
> the right question for your use case is: which channels do you need? we can tell you what's stable today and what's still bumpy.

**4. On "how is this different from just using a task board like Linear":**
> Linear is a human-readable task board. Reflectt is a machine-readable one with agent-native primitives: agents can poll it, claim tasks, update state, and trigger handoffs autonomously. humans can see it too — but the primary user is the agent.
>
> that difference sounds small until you try to put an agent on Linear. the agent can't own its own work there. on Reflectt it can.

**5. On "my agents keep stepping on each other":**
> that's exactly the coordination problem Reflectt is designed for. narrow lanes (each agent has one job, end to end), shared task state (agents see what's claimed, what's in review, what's done), and reviewer handoffs (nothing ships without a sign-off).
>
> if you're already running multiple agents and hitting collisions — that's the use case. the question is whether our channel integrations are stable enough for your setup right now. we'd say: core loop is solid, some channel layer rough edges remain.

**6. On "the attribution model is confusing":**
> attribution is genuinely complex and our reporting isn't fully shipped yet. what works today: UTM-tagged traffic shows up in the funnel (landing views, CTA clicks). what's still being closed: full report auth access, multi-touch attribution, session-level detail.
>
> if attribution is critical for your decision-making right now, tell us — we can scope what we have vs what's coming and give you a realistic timeline.

---

## Reply Principles

1. **Acknowledge before redirecting** — "that's fair" or "we're aware" before the pivot
2. **Be specific about what's broken** — don't say "minor issues" when you can say "browser session expiry"
3. **Separate core primitives from channel layer** — coordination is solid, channel integrations are bumpy
4. **Never claim a regression is fixed when it isn't**
5. **Name the integration if you can** — "email path" not "notifications"
6. **Redirect to what's working** — "the coordination layer itself is stable"

---

## UTM Tagging

Any links in replies:
`https://app.reflectt.ai/live?utm_source=x&utm_medium=reply&utm_campaign=capabilities-objection&utm_term=<topic>`

