# Reflectt Host v2: Agent Operability

## 1. What causes churn

### 1) Setup failure
This is the first and quietest churn killer.

People do not leave because they decided the product philosophy was wrong. They leave because they never got to a working agent outcome fast enough to care. If first-run requires guessing, hidden prerequisites, or internal knowledge, users disappear before they ever become users.

What this feels like in practice:
- capability surfaces without actionable next steps
- unclear host/agent setup order
- too much architecture exposed before first value
- “API exists” but no obvious path to “I used it successfully”

### 2) Cost shock
This is week-one silent churn.

Users will tolerate confusion longer than they tolerate fear of runaway spend. Cost anxiety does not always produce complaints. People just stop using the system because they do not trust its cost behavior.

What this feels like in practice:
- no clear spend caps
- no visible model-routing policy
- no predictable default budget behavior
- a sense that experimentation could turn into an invisible bill

### 3) Agent amnesia
This is the loudest churn killer and the hardest one to recover from.

If the system loses context between sessions, users stop believing work accumulates. At that point the product feels like stateless theater.

What this feels like in practice:
- memory scattered across SOUL.md, MEMORY.md, HEARTBEAT.md, and prompt habits
- agents re-reading their identity and constraints every session
- wrong answers when one file is missed
- continuity depending on ritual instead of runtime guarantees

The order matters:
- setup failure kills activation
- cost shock kills continued experimentation
- amnesia kills long-term trust

---

## 2. What primitives solve it

### Setup wizard
Solves churn cause #1.

The setup wizard exists to get a new user to a working first agent in under five minutes, with one obvious path and one visible success moment. The system should create value before asking the user to understand architecture.

This means:
- opinionated defaults
- one guided first workflow
- failure recovery at each step
- visible proof of first success

### Cost policy
Solves churn cause #2.

Cost policy makes spending behavior explicit before users are asked to trust it.

This means:
- spend caps per agent/team
- model routing by task type and budget
- visible default policies
- predictable runtime behavior under budget constraints

### Host-managed memory
Solves churn cause #3.

This is the architectural shift.

Memory, context injection, constraint enforcement, and task awareness should be owned by the host runtime, not by prompt rituals. The agent should wake up oriented instead of reconstructing itself from files.

This means:
- persistent memory store
- retrieval on boot
- host-owned context hydration
- runtime-owned task/context awareness
- continuity across session restarts

### Runs as UX
This is the primitive that makes dependability legible.

Users need to understand work as a coherent run, not as scattered traces. A run should show initiation, actions, review, merge, and handoff as one unit of work.

This matters because the fastest proof of dependability is not an abstract dashboard. It is a real workflow that completes cleanly.

### Decision logs
This is the trust primitive.

Users do not just want logs of what happened. They want to know:
- what the agent chose
- what it considered
- what constraint drove the choice

Decision logs rebuild trust after failures better than generic activity feeds.

---

## 3. What already exists

The product is not starting from zero. Several core primitives already exist and are solid enough to build on.

### Solid
- **Tasks** — CRUD, attribution, org health, real operational utility
- **Approvals** — review gates work
- **Routing** — routing policies exist and are real

### Partial
- **Runs** — action recordings exist, but not as first-class run UX
- **Artifacts** — recordings capture some output, but there is no general artifact layer
- **Logs** — activity feed exists, but not structured as decision logs

### Missing
- **Memory** — currently file-based only, not queryable, not host-managed as a runtime primitive
- **Costs** — no explicit cost policy system

That means the real product build is not “invent everything.” It is:
- complete the missing durability primitives
- promote partial primitives into trustworthy product surfaces
- stop leaving agent lifecycle in prompts where it erodes

---

## 4. What MVP proves dependability fastest

The MVP that proves dependability fastest is not “more capabilities.” It is one workflow that demonstrates continuity, trust, and completion.

The strongest candidate is:
**PR review → merge → handoff, surfaced as an `agent_run`**

Why this workflow wins:
- it is already close to how we actually operate
- it exercises task awareness, review, approval, and ownership transfer
- it exposes where memory breaks, where handoff breaks, and where trust breaks
- it can produce visible proof of a completed run

A dependable version of this workflow would show:
- run created with clear goal
- agent actions attached to the run
- review decision attached to the run
- merge outcome attached to the run
- handoff state attached to the run
- decision log explaining key choices and constraints

If that works, users feel the system as dependable instead of merely capable.

So the MVP sequence should be:
1. **Setup wizard** — get to first working agent fast
2. **Host-managed memory** — make continuity real
3. **Cost policy** — make experimentation safe
4. **Agent runs + decision logs** around a real workflow like PR review → merge → handoff

That is the shortest path to proving Reflectt Host v2 is a dependable runtime for agent operation.

The product we need is simple to state:
The host should own the durable truths, and the agent should wake up already oriented.
