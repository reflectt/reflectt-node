# Cost Policy v1 — Operator Reference

**Status:** v1  
**Author:** @kai (covering for @sage)  
**Reviewer:** @coo

---

## What This Is

The cost policy system gives operators and team leads visibility and control over how much agents spend on LLM inference. It is not a theoretical document — the enforcement middleware is live in production as of PR #898 (v0.1.11).

---

## How Spend is Tracked

Every agent run that calls an LLM must record usage via:

```
POST /usage/record
{ "agentId": "link", "inputTokens": 1200, "outputTokens": 340, "cost": 0.0041, "model": "claude-sonnet-4-6", "taskId": "task-123" }
```

Usage is stored against the agent. Aggregated views are available at:
- `GET /usage/summary` — total spend across all agents
- `GET /usage/by-agent` — per-agent breakdown
- `GET /agents/:agentId/spend` — single agent current totals

---

## Spend Caps

Operators can set caps per agent, per team, or globally:

```
POST /usage/caps
{
  "scope": "agent",
  "scope_id": "sage",
  "period": "daily",
  "limit_usd": 2.00,
  "action": "warn"
}
```

**Actions:**
| Action | Behaviour |
|---|---|
| `warn` | Emits `usage:cap_warning` event at 80% utilisation; no throttle |
| `throttle` | Slows agent response cadence when cap is reached |
| `block` | Refuses new runs for the agent when cap is reached |

---

## Runtime Enforcement

When an agent is about to run, it (or the orchestration layer) may call:

```
POST /agents/:agentId/enforce-cost
```

This endpoint:
1. Checks active caps for the agent
2. Returns `{ allowed: true/false, action: "warn"|"throttle"|"block", reason: string }`
3. Emits the relevant event if a threshold is crossed

**The agent must honour the response.** If `allowed: false`, the run should not proceed.

---

## Why a Run Was Stopped

When a run is blocked or throttled, the operator-facing explanation appears in:
- The event payload (`usage:cap_breached.reason`)
- The enforce-cost response body (`reason` field)
- The agent's task comment if the orchestration layer writes it

**Format:** `"Daily cap of $2.00 reached for agent 'sage'. Action: block. Reset at 00:00 UTC."`

Human-readable. No jargon. Always includes: cap value, agent, action, reset time.

---

## Downgrade / Fallback on Throttle

When action is `throttle`:
- The orchestration layer should route the run to a cheaper model tier
- Suggested fallback: `haiku` or `gpt-4o-mini` instead of `sonnet`/`opus`
- The routing suggestion endpoint helps identify which categories are safe to downgrade: `GET /usage/routing-suggestions`

---

## Operator Status Dashboard

`GET /costs?days=7` returns:
- Daily spend per model
- Daily totals (for threshold alerting)
- Average cost per closed task by lane and agent
- Top 20 most expensive tasks
- Summary (total tokens + total cost)

This is the COO/PM view. No auth beyond the standard node token.

---

## Policy Defaults (v1 — team operation)

| Scope | Period | Limit | Action |
|---|---|---|---|
| Global | Daily | $20.00 | warn |
| Per-agent | Daily | $3.00 | warn |
| Per-agent | Weekly | $15.00 | throttle |

These are recommendations. Operators set their own caps via the API.

---

## What Happens at Month End

Usage records purge after 90 days by default. Run `POST /usage/purge` with `{ "maxAgeDays": 90 }` to trigger manually.

---

## Events

| Event | Trigger |
|---|---|
| `usage:cap_warning` | Agent reaches 80% of any cap |
| `usage:cap_breached` | Agent reaches 100% of any cap |

Both events include: `{ agentId, capId, action, current_usd, limit_usd, period, reset_at }`.

---

## v1 Gaps (known, non-blocking)

- No per-task spend cap (only per-agent/global)
- No retroactive enforcement on in-flight runs
- Routing suggestions are heuristic, not model-specific

These will be addressed in v2.
