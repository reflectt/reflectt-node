# Objection Handling Pack — Reflectt Growth
**Author:** kindling
**Date:** 2026-03-29
**Purpose:** Handle common objections in Reddit/HN/IndieHackers/community threads

---

## Core Objections (Ranked by Frequency)

### 1. "Another tool to manage — I don't need more complexity"
**Frequency:** Very High
**Context:** Solo founders, indie builders, small teams

**Response frame:**
> The goal is to reduce coordination overhead, not add to it. If running 3 agents feels like managing 3 employees, something is wrong with the setup. The test is: do you spend more time managing the system than the work gets done?

**Pivot:** Ask what their current agent coordination looks like. If they don't have one yet, this is a presale moment.

---

### 2. "LangGraph / CrewAI / AutoGen does this already"
**Frequency:** High
**Context:** Technical builders, HN crowd

**Response frame:**
> Those frameworks solve orchestration. They don't solve coordination — who owns task state, what happens when two agents claim the same job, how does a human sign off before something ships. The framework handles the flow; Reflectt handles the ops layer.

**Pivot:** Ask if their agents have a shared inbox or if each agent just runs its own pipeline independently.

---

### 3. "I can just use a spreadsheet / Notion / Linear"
**Frequency:** Medium
**Context:** PMs, small team leads

**Response frame:**
> Spreadsheets work until you have agents that need to read and write to them autonomously. The difference is: can your task tool handle machine-readable state, not just human-readable state? That's the gap Reflectt fills.

**Pivot:** Ask if they've tried putting an agent on Linear. Does it work cleanly or do they spend time re-explaining context?

---

### 4. "Sounds overengineered for my use case"
**Frequency:** Medium
**Context:** Solo operators, simple workflows

**Response frame:**
> For one agent doing one task, you don't need it. For two or more agents working on related things — even just a coding agent and a review agent — you need a shared state layer or they step on each other. Start simple, grow into it.

**Pivot:** This is a "just in time" objection — don't oversell. Let them discover the need.

---

### 5. "What if the agent does something wrong and I don't catch it?"
**Frequency:** High
**Context:** Risk-averse founders, enterprise-adjacent

**Response frame:**
> That's what reviewer handoffs solve. The agent can't close a task without a human (or another agent) approving. It's enforced, not suggested. No silent ships.

**Pivot:** Ask how they currently handle code review for AI-generated work. If the answer is "I just check the output" — that's exactly the problem.

---

### 6. "My agents already talk to each other via Slack/Discord"
**Frequency:** Medium
**Context:** Teams with existing AI workflows

**Response frame:**
> Talking isn't coordinating. If agents are dumping messages into a channel and hoping someone reads it, that's a notification system, not a coordination layer. Coordination means: shared task state, clear ownership, no collisions.

**Pivot:** Ask if they have a case where two agents worked on the same thing without knowing it.

---

### 7. "This is just Jira for AI agents"
**Frequency:** Low-Medium
**Context:** PMs, skeptical technical crowd

**Response frame:**
> Jira was designed for humans reading a board. Agents don't read boards — they need machine-readable state. Reflectt is built for agents first, with a human-readable canvas as an optional layer. Different design constraints from the ground up.

**Pivot:** Don't oversell the comparison. It's a metaphor, not the product.

---

### 8. "How is this different from Zapier / Make / n8n?"
**Frequency:** Medium
**Context:** Automation-focused builders

**Response frame:**
> Zapier and Make are for human-triggered workflows. Reflectt is for autonomous agent workflows — agents that run on schedules, make decisions, hand off to each other without a human in the loop. Different execution model.

**Pivot:** Ask if their "automation" runs on a schedule or requires human triggers.

---

### 9. "It's too early for this — AI agents aren't mature enough"
**Frequency:** Low
**Context:** Cautious HN crowd

**Response frame:**
> The coordination problem exists right now, even with imperfect agents. The tools you use to solve it shape how your workflow evolves. Better to build on something that handles coordination correctly than to retrofit it later.

**Pivot:** Acknowledge the point — don't argue. The real buyers are people already hitting the problem.

---

### 10. "I don't trust autonomous agents to do meaningful work"
**Frequency:** Medium
**Context:** Risk-averse, enterprise-adjacent

**Response frame:**
> That's a workflow design question, not a technology question. Agents can do meaningful work with proper reviewer gates and explicit state. The question is whether your system enforces quality control or lets agents run open-loop.

**Pivot:** The objection is really about trust in the workflow, not AI capability.

---

## Thread-Specific Handling

### r/AI_Agents
- Lead with technical depth — this crowd wants specifics
- Acknowledge tradeoffs honestly
- Don't oversell; let the product speak
- Links to docs or live canvas > pitch

### r/Entrepreneur / r/SideProject
- Lead with time savings and simplicity
- "a team of agents without the overhead" framing works
- Founder-friendly: no long onboarding pitch

### Hacker News
- Be brief. One concrete example beats a paragraph.
- Don't drop links without context
- Earn the link with a good comment first

### IndieHackers
- Value stories: "we ran X agents and saved Y hours"
- Show the workflow, not just the product
- Revenue/reliability framing > feature list

---

## Response Rules

1. **Earn the thread first** — don't lead with a pitch
2. **Acknowledge before pivoting** — "that's a fair concern" or "you're right that X is harder than it sounds"
3. **One objection, one response** — don't堆砌 features
4. **Link only when context is earned** — don't link-drop without substance
5. **Ask a question back** — turns a pitch into a conversation

