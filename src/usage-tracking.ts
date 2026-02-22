// SPDX-License-Identifier: Apache-2.0
// Usage Tracking — Model API cost instrumentation + spend caps
//
// Stores per-call usage events with token counts and estimated costs.
// Provides aggregation by agent, task, model, and time period.
// Enforces configurable spend caps with warn/throttle/block actions.

import { getDb } from './db.js'
import { eventBus } from './events.js'

// ── Types ──

export interface UsageEvent {
  id: string
  agent: string
  task_id?: string
  model: string
  provider: string
  input_tokens: number
  output_tokens: number
  estimated_cost_usd: number
  category: 'task_work' | 'heartbeat' | 'reflection' | 'chat' | 'review' | 'other'
  timestamp: number
  team_id?: string
  metadata?: Record<string, unknown>
}

export interface SpendCap {
  id: string
  scope: 'global' | 'agent' | 'team'
  scope_id?: string          // agent name or team_id (null for global)
  period: 'daily' | 'weekly' | 'monthly'
  limit_usd: number
  action: 'warn' | 'throttle' | 'block'
  enabled: boolean
  created_at: number
  updated_at: number
}

export interface UsageSummary {
  period: string
  total_cost_usd: number
  total_input_tokens: number
  total_output_tokens: number
  event_count: number
}

export interface AgentUsage {
  agent: string
  total_cost_usd: number
  total_input_tokens: number
  total_output_tokens: number
  event_count: number
  top_model: string
}

export interface CapStatus {
  cap: SpendCap
  current_spend_usd: number
  remaining_usd: number
  utilization_pct: number
  breached: boolean
}

// ── Model Pricing (estimated, per 1M tokens) ──

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4': { input: 15.0, output: 75.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'gpt-5.3': { input: 2.0, output: 8.0 },
  'gpt-5.3-codex': { input: 2.0, output: 8.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.5, output: 10.0 },
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Try exact match, then prefix match
  let pricing = MODEL_PRICING[model]
  if (!pricing) {
    const key = Object.keys(MODEL_PRICING).find(k => model.includes(k))
    pricing = key ? MODEL_PRICING[key] : { input: 5.0, output: 20.0 } // conservative default
  }
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}

// ── DB Setup ──

export function ensureUsageTables(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_usage (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      task_id TEXT,
      model TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'unknown',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'other',
      team_id TEXT,
      metadata TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_agent ON model_usage(agent);
    CREATE INDEX IF NOT EXISTS idx_usage_ts ON model_usage(timestamp);
    CREATE INDEX IF NOT EXISTS idx_usage_model ON model_usage(model);
    CREATE INDEX IF NOT EXISTS idx_usage_task ON model_usage(task_id);

    CREATE TABLE IF NOT EXISTS spend_caps (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'global',
      scope_id TEXT,
      period TEXT NOT NULL DEFAULT 'monthly',
      limit_usd REAL NOT NULL,
      action TEXT NOT NULL DEFAULT 'warn',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
}

// ── Usage Recording ──

export function recordUsage(event: Omit<UsageEvent, 'id' | 'estimated_cost_usd'> & { estimated_cost_usd?: number }): UsageEvent {
  ensureUsageTables()
  const db = getDb()

  const id = `usage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const cost = event.estimated_cost_usd ?? estimateCost(event.model, event.input_tokens, event.output_tokens)

  const record: UsageEvent = {
    id,
    agent: event.agent,
    task_id: event.task_id,
    model: event.model,
    provider: event.provider,
    input_tokens: event.input_tokens,
    output_tokens: event.output_tokens,
    estimated_cost_usd: Math.round(cost * 1_000_000) / 1_000_000, // 6 decimal precision
    category: event.category,
    timestamp: event.timestamp || Date.now(),
    team_id: event.team_id,
    metadata: event.metadata,
  }

  db.prepare(`
    INSERT INTO model_usage (id, agent, task_id, model, provider, input_tokens, output_tokens, estimated_cost_usd, category, team_id, metadata, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id, record.agent, record.task_id || null, record.model, record.provider,
    record.input_tokens, record.output_tokens, record.estimated_cost_usd,
    record.category, record.team_id || null,
    record.metadata ? JSON.stringify(record.metadata) : null,
    record.timestamp,
  )

  // Check caps after recording
  checkCaps(record)

  return record
}

export function recordUsageBatch(events: Array<Omit<UsageEvent, 'id' | 'estimated_cost_usd'> & { estimated_cost_usd?: number }>): UsageEvent[] {
  return events.map(e => recordUsage(e))
}

// ── Aggregation ──

export function getUsageSummary(options: {
  since?: number
  until?: number
  agent?: string
  team_id?: string
  group_by?: 'day' | 'week' | 'month'
} = {}): UsageSummary[] {
  ensureUsageTables()
  const db = getDb()

  const conditions: string[] = []
  const params: unknown[] = []

  if (options.since) { conditions.push('timestamp >= ?'); params.push(options.since) }
  if (options.until) { conditions.push('timestamp <= ?'); params.push(options.until) }
  if (options.agent) { conditions.push('agent = ?'); params.push(options.agent) }
  if (options.team_id) { conditions.push('team_id = ?'); params.push(options.team_id) }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = db.prepare(`
    SELECT
      'total' as period,
      COALESCE(SUM(estimated_cost_usd), 0) as total_cost_usd,
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens,
      COUNT(*) as event_count
    FROM model_usage ${where}
  `).all(...params) as UsageSummary[]

  return rows
}

export function getUsageByAgent(options: { since?: number; until?: number } = {}): AgentUsage[] {
  ensureUsageTables()
  const db = getDb()

  const conditions: string[] = []
  const params: unknown[] = []
  if (options.since) { conditions.push('timestamp >= ?'); params.push(options.since) }
  if (options.until) { conditions.push('timestamp <= ?'); params.push(options.until) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return db.prepare(`
    SELECT
      agent,
      SUM(estimated_cost_usd) as total_cost_usd,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      COUNT(*) as event_count,
      (SELECT model FROM model_usage m2 WHERE m2.agent = model_usage.agent GROUP BY model ORDER BY SUM(estimated_cost_usd) DESC LIMIT 1) as top_model
    FROM model_usage ${where}
    GROUP BY agent
    ORDER BY total_cost_usd DESC
  `).all(...params) as AgentUsage[]
}

export function getUsageByModel(options: { since?: number; until?: number } = {}): Array<{
  model: string; total_cost_usd: number; total_input_tokens: number; total_output_tokens: number; event_count: number
}> {
  ensureUsageTables()
  const db = getDb()

  const conditions: string[] = []
  const params: unknown[] = []
  if (options.since) { conditions.push('timestamp >= ?'); params.push(options.since) }
  if (options.until) { conditions.push('timestamp <= ?'); params.push(options.until) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return db.prepare(`
    SELECT model, SUM(estimated_cost_usd) as total_cost_usd, SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens, COUNT(*) as event_count
    FROM model_usage ${where}
    GROUP BY model ORDER BY total_cost_usd DESC
  `).all(...params) as any[]
}

export function getUsageByTask(options: { since?: number; until?: number; limit?: number } = {}): Array<{
  task_id: string; total_cost_usd: number; event_count: number
}> {
  ensureUsageTables()
  const db = getDb()
  const limit = options.limit ?? 50

  const conditions: string[] = ['task_id IS NOT NULL']
  const params: unknown[] = []
  if (options.since) { conditions.push('timestamp >= ?'); params.push(options.since) }
  if (options.until) { conditions.push('timestamp <= ?'); params.push(options.until) }
  const where = `WHERE ${conditions.join(' AND ')}`

  return db.prepare(`
    SELECT task_id, SUM(estimated_cost_usd) as total_cost_usd, COUNT(*) as event_count
    FROM model_usage ${where}
    GROUP BY task_id ORDER BY total_cost_usd DESC LIMIT ?
  `).all(...params, limit) as any[]
}

// ── Spend Caps ──

export function setCap(cap: Omit<SpendCap, 'id' | 'created_at' | 'updated_at'>): SpendCap {
  ensureUsageTables()
  const db = getDb()
  const now = Date.now()
  const id = `cap-${now}-${Math.random().toString(36).slice(2, 7)}`

  const record: SpendCap = { id, ...cap, created_at: now, updated_at: now }

  db.prepare(`
    INSERT INTO spend_caps (id, scope, scope_id, period, limit_usd, action, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, record.scope, record.scope_id || null, record.period, record.limit_usd, record.action, record.enabled ? 1 : 0, now, now)

  return record
}

export function listCaps(): SpendCap[] {
  ensureUsageTables()
  const db = getDb()
  return (db.prepare('SELECT * FROM spend_caps WHERE enabled = 1 ORDER BY created_at DESC').all() as any[]).map(r => ({
    ...r, enabled: !!r.enabled,
  }))
}

export function deleteCap(id: string): boolean {
  ensureUsageTables()
  const db = getDb()
  const result = db.prepare('DELETE FROM spend_caps WHERE id = ?').run(id)
  return result.changes > 0
}

function getPeriodStart(period: 'daily' | 'weekly' | 'monthly'): number {
  const now = new Date()
  if (period === 'daily') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  } else if (period === 'weekly') {
    const day = now.getDay()
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) // Monday start
    return new Date(now.getFullYear(), now.getMonth(), diff).getTime()
  } else {
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  }
}

export function checkCaps(event?: UsageEvent): CapStatus[] {
  const caps = listCaps()
  const results: CapStatus[] = []

  for (const cap of caps) {
    const periodStart = getPeriodStart(cap.period)
    const conditions: string[] = ['timestamp >= ?']
    const params: unknown[] = [periodStart]

    if (cap.scope === 'agent' && cap.scope_id) {
      conditions.push('agent = ?')
      params.push(cap.scope_id)
    } else if (cap.scope === 'team' && cap.scope_id) {
      conditions.push('team_id = ?')
      params.push(cap.scope_id)
    }

    const db = getDb()
    const row = db.prepare(`
      SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
      FROM model_usage WHERE ${conditions.join(' AND ')}
    `).get(...params) as { total: number }

    const currentSpend = row.total
    const remaining = Math.max(0, cap.limit_usd - currentSpend)
    const utilization = cap.limit_usd > 0 ? (currentSpend / cap.limit_usd) * 100 : 0
    const breached = currentSpend >= cap.limit_usd

    const status: CapStatus = {
      cap,
      current_spend_usd: Math.round(currentSpend * 100) / 100,
      remaining_usd: Math.round(remaining * 100) / 100,
      utilization_pct: Math.round(utilization * 10) / 10,
      breached,
    }

    results.push(status)

    // Emit events on breach or warning (>80%)
    if (event && breached) {
      eventBus.emit({
        type: 'task_updated' as any,
        data: { kind: 'usage:cap_breached', source: 'usage-tracking', cap_id: cap.id, scope: cap.scope, scope_id: cap.scope_id, current_spend: currentSpend, limit: cap.limit_usd, action: cap.action },
      } as any)
    } else if (event && utilization >= 80) {
      eventBus.emit({
        type: 'task_updated' as any,
        data: { kind: 'usage:cap_warning', source: 'usage-tracking', cap_id: cap.id, scope: cap.scope, scope_id: cap.scope_id, current_spend: currentSpend, limit: cap.limit_usd, utilization_pct: utilization },
      } as any)
    }
  }

  return results
}

// ── Routing Suggestions ──

export function getRoutingSuggestions(options: { since?: number } = {}): Array<{
  category: string
  current_model: string
  suggested_model: string
  current_cost_usd: number
  projected_cost_usd: number
  savings_usd: number
  savings_pct: number
}> {
  ensureUsageTables()
  const db = getDb()
  const since = options.since ?? Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days

  const categories = db.prepare(`
    SELECT category, model,
      SUM(estimated_cost_usd) as total_cost,
      SUM(input_tokens) as total_input,
      SUM(output_tokens) as total_output
    FROM model_usage WHERE timestamp >= ?
    GROUP BY category, model
    ORDER BY total_cost DESC
  `).all(since) as Array<{ category: string; model: string; total_cost: number; total_input: number; total_output: number }>

  const suggestions: ReturnType<typeof getRoutingSuggestions> = []
  const cheapModel = 'gpt-4o-mini'
  const lowStakesCategories = ['heartbeat', 'reflection', 'chat']

  for (const row of categories) {
    if (!lowStakesCategories.includes(row.category)) continue
    if (row.model === cheapModel) continue

    const projectedCost = estimateCost(cheapModel, row.total_input, row.total_output)
    const savings = row.total_cost - projectedCost

    if (savings > 0.01) {
      suggestions.push({
        category: row.category,
        current_model: row.model,
        suggested_model: cheapModel,
        current_cost_usd: Math.round(row.total_cost * 100) / 100,
        projected_cost_usd: Math.round(projectedCost * 100) / 100,
        savings_usd: Math.round(savings * 100) / 100,
        savings_pct: Math.round((savings / row.total_cost) * 100),
      })
    }
  }

  return suggestions.sort((a, b) => b.savings_usd - a.savings_usd)
}
