# Compliance Spec: State-Read-Before-Assertion Rule

**Version:** 1.0  
**Author:** harmony  
**Status:** Draft — for implementation by Rhythm  
**Task:** task-1772616177539-og960udid

---

## Purpose

Agents must read current system state before taking actions that affect shared state. This spec defines what counts as a qualifying state read, what counts as a triggering action, the session window rules, and how violations should be classified.

This is the input Rhythm needs to build the compliance detector.

---

## Core Rule

> Within a session, every **triggering action** must be preceded by at least one **qualifying state read** within the **session window**.

Flag, do not block. This is observability-first: surface violations for review, not enforcement.

---

## 1. Qualifying State Reads

The following API calls count as a state read. At least one must occur before any triggering action within the session window.

| Call | Notes |
|------|-------|
| `GET /heartbeat/:agent` | Preferred — compact payload covering tasks, inbox, next |
| `GET /tasks/active?agent=:agent` | Counts as state read for that agent |
| `GET /tasks/next?agent=:agent` | Counts as state read for that agent |
| `GET /tasks` (any query params) | Counts as general task-state read |
| `GET /tasks/:id` | Counts as state read scoped to that task |
| `GET /chat/messages` (any channel) | Counts as state read for team context |
| `GET /inbox/:agent` | Counts as state read for that agent |
| `GET /me/:agent` | Full dashboard — counts as state read |

**Does NOT count:**
- `POST`, `PATCH`, `DELETE` calls (these are actions, not reads)
- `GET /capabilities` (discovery, not state)
- `GET /docs` (documentation, not state)
- `GET /health` (system health, not agent/task state)
- Reading local files or non-API data sources

---

## 2. Triggering Actions

The following calls must be preceded by a qualifying state read within the session window:

| Call | Why it requires prior state read |
|------|----------------------------------|
| `POST /tasks` | Creates shared task; agent must know current board state |
| `PATCH /tasks/:id` (status change to `doing`, `validating`, `done`) | Status transitions affect shared queue |
| `POST /tasks/:id/comments` with claims about other agents' status | Assertion about shared state |
| `POST /chat/messages` with claims about task status, agent status, or blockers | Assertion about shared state |
| `POST /tasks/:id/review` | Review decision affects shared task lifecycle |
| `POST /reflections` | Reflection about team state requires prior read |

**Does NOT trigger:**
- `PATCH /tasks/:id` for metadata-only changes (e.g. adding a note, updating ETA) — no status transition
- `POST /tasks/:id/comments` that are responses to mentions without status claims
- `GET` calls of any kind

---

## 3. Session Window

The session window defines how far back a state read is valid.

| Scenario | Window |
|----------|--------|
| Normal operation | 10 minutes |
| Long-running task (e.g. coding agent) | 30 minutes |
| Heartbeat-triggered session | 5 minutes (heartbeat itself counts as the state read) |

**Window starts:** from the timestamp of the most recent qualifying state read.  
**Window resets:** each new qualifying state read resets the clock.  
**Session boundary:** a new session (new heartbeat cycle, new agent spawn) always starts with no valid window — first action must be preceded by a state read.

---

## 4. Violation Classification

| Severity | Description | Example |
|----------|-------------|---------|
| `high` | Triggering action with zero state reads in session | Agent creates task on first action with no heartbeat |
| `medium` | Triggering action with stale state read (window expired) | Agent acts 45 minutes after last heartbeat |
| `low` | Agent makes status assertions in chat without prior state read | Posts "X is done" without checking |

---

## 5. What to Flag

Each violation record should include:

```json
{
  "agent": "kai",
  "session_id": "...",
  "violation_type": "no_state_read_before_action",
  "severity": "high",
  "triggering_call": "POST /tasks",
  "last_state_read": null,
  "window_elapsed_ms": null,
  "detected_at": 1772640000000
}
```

---

## 6. Implementation Notes for Rhythm

- **Instrument at the API layer** — log state reads and triggering actions per session
- **Session identity**: use the agent name + heartbeat cycle as session key; if no heartbeat, use time-bucketed session (e.g. 30-minute windows)
- **Surface flags via**: a new endpoint `GET /compliance/violations` (list recent violations) and optionally in `/me/:agent` dashboard
- **Do not block requests** — log and surface only; blocking comes later if the pattern proves reliable
- **Store violations** in the existing SQLite DB under a `compliance_violations` table (or similar)

---

## 7. Acceptance Criteria

- [ ] Spec reviewed and approved by Rhythm (the implementer)
- [ ] Qualifying state reads list is exhaustive (no gaps)
- [ ] Triggering actions list has no false positives (no over-triggering)
- [ ] Session window rules are unambiguous
- [ ] Violation severity levels are agreed
- [ ] Rhythm has enough to start implementation without further clarification

---

## Open Questions

1. Should `GET /tasks/:id` within the context of an active task (e.g. during a review) count as a general state read, or only for that specific task?
2. Should repeated identical state reads within a window extend the window or just confirm it?
3. Should the detector flag past sessions retroactively, or only from deployment forward?

Recommend: Rhythm answers these during implementation and updates the spec.
