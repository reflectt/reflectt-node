# Monetization Test #1: API Cost Guardrails + Smart Routing

## Day-1 Checkpoint: Scope Alignment + Instrumentation Plan

### Problem Statement
Teams running AI agents need spend predictability. Currently:
- No visibility into per-agent or per-task model API costs
- No way to set spending limits or alerts
- No automatic routing to cheaper models for low-stakes work
- Teams can't budget for agent operations

### Value Proposition
**"Know what you're spending, control where it goes."**

Three features, tiered:
1. **Cost Dashboard** (free) — See per-agent, per-task token usage and estimated cost
2. **Spend Caps** (pro) — Set daily/weekly/monthly limits per team, per agent, or globally
3. **Smart Routing** (pro) — Auto-route to cheaper models for heartbeats, status checks, reflections

### ICP (Ideal Customer Profile)
- Teams with 3+ AI agents running on OpenClaw
- Monthly LLM spend > $50
- Pain: surprise bills, no cost attribution, overspending on simple tasks

### Instrumentation Plan

#### Phase 1: Event Tracking (Day 1-2)
Add `model_usage` event to telemetry:

```typescript
interface ModelUsageEvent {
  agent: string
  task_id?: string
  model: string          // e.g., "claude-sonnet-4-6"
  provider: string       // e.g., "anthropic"
  input_tokens: number
  output_tokens: number
  estimated_cost_usd: number  // based on published pricing
  category: 'task_work' | 'heartbeat' | 'reflection' | 'chat' | 'review' | 'other'
  timestamp: number
}
```

**Where to instrument:**
- OpenClaw gateway already proxies LLM calls — add token counting there
- reflectt-node receives model info via task metadata (`model_resolved` field)
- For MVP: accept usage reports via `POST /usage/report` endpoint

#### Phase 2: Cost Aggregation (Day 2-3)
- SQLite table: `model_usage` with per-event rows
- Aggregation endpoints:
  - `GET /usage/summary` — total cost by period (day/week/month)
  - `GET /usage/by-agent` — cost breakdown per agent
  - `GET /usage/by-task` — cost attribution to tasks
  - `GET /usage/by-model` — which models cost the most

#### Phase 3: Spend Caps (Day 3-4)
- `POST /usage/caps` — set spending limits
- `GET /usage/caps` — view current caps
- Cap types: `daily`, `weekly`, `monthly`
- Scope: `global`, `per-agent`, `per-team`
- Actions when cap hit: `warn`, `throttle` (downgrade model), `block`
- EventBus: `usage:cap_warning`, `usage:cap_breached`

#### Phase 4: Smart Routing Suggestions (Day 4-5)
- Categorize tasks by stakes: heartbeat/status → low, code review → medium, feature work → high
- Routing table: `{ category, suggested_model, fallback_model, max_cost_per_call }`
- `GET /usage/routing-suggestions` — show where money could be saved
- Display savings estimate: "If you routed heartbeats to gpt-4o-mini, you'd save ~$X/month"

### Model Pricing Reference (estimated, as of 2026-02)
| Model | Input $/1M tokens | Output $/1M tokens |
|-------|-------------------|--------------------|
| claude-opus-4 | $15.00 | $75.00 |
| claude-sonnet-4 | $3.00 | $15.00 |
| gpt-5.3 | $2.00 | $8.00 |
| gpt-5.3-codex | $2.00 | $8.00 |
| gpt-4o-mini | $0.15 | $0.60 |

### Success Metrics
- **Adoption:** ≥60% of trial users enable at least one cap/routing control
- **WTP signal:** ≥3 users express willingness to pay for cap/routing features
- **Pilot asks:** ≥2 users request extended trial or ask about pricing

### Architecture Decision
- All usage data stored locally in SQLite (same as tasks, reflections)
- No data leaves the node unless telemetry is opt-in
- Cloud dashboard gets usage via same relay pattern as chat/tasks
- Caps enforced at node level (no cloud dependency)

### Non-Goals (this test)
- Actual billing/payment processing
- Multi-provider cost optimization
- Fine-grained token budgets per conversation
- Real-time cost streaming (batch is fine for MVP)

---

**Status:** Day-1 complete — scope aligned, instrumentation plan documented.
**Next:** Build `POST /usage/report` + `model_usage` table + aggregation endpoints (Day 2-3).
