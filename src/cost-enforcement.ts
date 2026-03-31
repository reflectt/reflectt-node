// SPDX-License-Identifier: Apache-2.0
// Runtime cost-policy enforcement middleware
import { getDb } from './db.js'
import { checkCostCap } from './agent-config.js'
import { eventBus } from './events.js'

export interface UsageRecord {
  agentId: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  timestamp: number
}

export interface EnforcementResult {
  allowed: boolean
  action: 'allow' | 'warn' | 'downgrade' | 'deny'
  model: string | null
  effectiveModel: string | null
  reason: string | null
  dailySpend: number
  monthlySpend: number
  dailyRemaining: number | null
  monthlyRemaining: number | null
}

export function getAgentSpend(agentId: string, opts?: { since?: number }): number {
  const db = getDb()
  try {
    const since = opts?.since ?? 0
    const row = db.prepare('SELECT COALESCE(SUM(cost), 0) as total FROM usage_log WHERE agent_id = ? AND timestamp >= ?').get(agentId, since) as { total: number } | undefined
    return row?.total ?? 0
  } catch { return 0 }
}

export function getDailySpend(agentId: string): number {
  const now = new Date()
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime()
  return getAgentSpend(agentId, { since: startOfDay })
}

export function getMonthlySpend(agentId: string): number {
  const now = new Date()
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime()
  return getAgentSpend(agentId, { since: startOfMonth })
}

export function recordUsage(record: UsageRecord): void {
  const db = getDb()
  db.prepare('INSERT INTO usage_log (agent_id, model, input_tokens, output_tokens, cost, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run(record.agentId, record.model, record.inputTokens, record.outputTokens, record.cost, record.timestamp)
}

export function getUsageByAgent(opts?: { since?: number }): Array<{ agentId: string; totalCost: number; totalInputTokens: number; totalOutputTokens: number; callCount: number }> {
  const db = getDb()
  try {
    const since = opts?.since ?? 0
    const rows = db.prepare('SELECT agent_id, COALESCE(SUM(cost), 0) as total_cost, COALESCE(SUM(input_tokens), 0) as total_input, COALESCE(SUM(output_tokens), 0) as total_output, COUNT(*) as call_count FROM usage_log WHERE timestamp >= ? GROUP BY agent_id ORDER BY total_cost DESC').all(since) as Array<{ agent_id: string; total_cost: number; total_input: number; total_output: number; call_count: number }>
    return rows.map(r => ({ agentId: r.agent_id, totalCost: r.total_cost, totalInputTokens: r.total_input, totalOutputTokens: r.total_output, callCount: r.call_count }))
  } catch { return [] }
}

export function enforcePolicy(agentId: string): EnforcementResult {
  const dailySpend = getDailySpend(agentId)
  const monthlySpend = getMonthlySpend(agentId)
  const result = checkCostCap(agentId, dailySpend, monthlySpend)
  let effectiveModel = result.model
  let reason: string | null = null
  switch (result.action) {
    case 'deny': effectiveModel = null; reason = 'Cost cap exceeded.'; break
    case 'downgrade': effectiveModel = result.fallbackModel ?? result.model; reason = `Cost >90%. Using fallback: ${effectiveModel}`; break
    case 'warn': reason = 'Cost >80%. Monitor usage.'; break
  }

  // Emit SSE events for enforcement actions (non-allow)
  if (result.action !== 'allow') {
    const now = Date.now()
    eventBus.emit({
      id: `cost-${now}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'canvas_render' as any,
      timestamp: now,
      data: {
        kind: `cost:${result.action}`,
        agentId,
        action: result.action,
        dailySpend,
        monthlySpend,
        dailyRemaining: result.dailyRemaining,
        monthlyRemaining: result.monthlyRemaining,
        model: result.model,
        effectiveModel,
        reason,
      },
    })
  }

  return { allowed: result.allowed, action: result.action, model: result.model, effectiveModel, reason, dailySpend, monthlySpend, dailyRemaining: result.dailyRemaining, monthlyRemaining: result.monthlyRemaining }
}

export function purgeUsageLog(maxAgeDays: number = 90): number {
  const db = getDb()
  try {
    const cutoff = Date.now() - maxAgeDays * 86400000
    return db.prepare('DELETE FROM usage_log WHERE timestamp < ?').run(cutoff).changes
  } catch { return 0 }
}

export function ensureUsageLogTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL, model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0, timestamp INTEGER NOT NULL, metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_usage_log_agent_ts ON usage_log(agent_id, timestamp);
  `)
}
