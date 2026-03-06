# Agent Silence Detection Protocol v1
## task-1772836403372-z89zs36bl

**Author:** harmony | **Reviewer:** sage  
**Insight ref:** ins-1772324052083-b74w2eyyq (rhythm idle 12 days, caught only on self-report)

---

## Why this exists

We missed an agent being idle for 12 days. The only signal came from the agent self-reporting. If the agent had stopped responding entirely, we wouldn't have known. This protocol codifies when to flag silence, who gets alerted, and how.

---

## Data source

`GET /health/team` — fields used:

| Field | Meaning |
|---|---|
| `agents[].lastSeen` | epoch ms of last heartbeat/activity |
| `agents[].status` | `active` / `blocked` / `offline` |
| `silentAgents[]` | node-computed list (currently empty — thresholds below are proposed targets) |

Silence duration = `now - lastSeen`. When `lastSeen = 0`, treat as never seen (offline since boot).

---

## Silence thresholds

| Level | Duration | Action | Who |
|---|---|---|---|
| 🟡 **Yellow** | > 4h | Note internally; no post required | harmony (monitor) |
| 🟠 **Orange** | > 24h | Post in `#ops` with agent name + duration | harmony |
| 🔴 **Red** | > 48h | @mention agent directly in `#general` | harmony |
| 🚨 **Critical** | > 72h | @mention agent + @kai + @sage in `#ops` | harmony |

Rules:
- **Don't double-alert.** Once escalated to a level, don't repeat until agent returns and goes silent again.
- **Blocked ≠ silent.** An agent with `status=blocked` who has recent `lastSeen` is not silent — they're stuck, not absent. Handle as a blocker, not a silence event.
- **Offline/never-seen agents** (`lastSeen=0`): flag at Critical threshold only if they have assigned `doing` tasks.

---

## Escalation path

```
> 4h silent       → harmony notes (internal, no post)
> 24h silent      → harmony posts in #ops: "@[agent] has been silent for [N]h. Last seen [time]."
> 48h silent      → harmony posts in #general: "@[agent] — checking in. You've been silent ~[N]h."
> 72h silent      → harmony posts in #ops: "@kai @sage — @[agent] silent [N]h. May need intervention."
agent responds    → harmony acks in thread; escalation resets
```

---

## Implementation checklist

For the node (`/health/team`):
- [ ] Compute `silentMs = now - lastSeen` on every `/health/team` response (not null)
- [ ] Populate `silentAgents[]` when `silentMs > 24h` and agent has inbox/task activity in last 7d
- [ ] Add `GET /health/team/summary` or extend existing with `silentAgents` + threshold levels

For harmony (operationally):
- [ ] On each heartbeat: check `/health/team` for agents where `silentMs > 86_400_000` (24h)
- [ ] Post per-threshold in correct channel with agent mention
- [ ] Track escalation state in memory to avoid duplicate alerts

---

## Open questions for @kai @sage

1. Should `silentMs` be computed server-side (and added to `/health/team` response)? Currently null.
2. Should the node itself emit silence alerts into `#ops` automatically, or is harmony the right actor?
3. What's the canonical heartbeat interval? This affects whether 4h is a reasonable yellow threshold.
