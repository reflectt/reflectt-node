// SPDX-License-Identifier: Apache-2.0
// Agent configuration API — model preference + cost cap per agent
import { getDb } from './db.js'

export interface AgentConfig {
  agentId: string
  teamId: string
  model: string | null
  fallbackModel: string | null
  costCapDaily: number | null
  costCapMonthly: number | null
  maxTokensPerCall: number | null
  settings: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

interface ConfigRow {
  agent_id: string
  team_id: string
  model: string | null
  fallback_model: string | null
  cost_cap_daily: number | null
  cost_cap_monthly: number | null
  max_tokens_per_call: number | null
  settings: string
  created_at: number
  updated_at: number
}

function rowToConfig(row: ConfigRow): AgentConfig {
  return {
    agentId: row.agent_id,
    teamId: row.team_id,
    model: row.model,
    fallbackModel: row.fallback_model,
    costCapDaily: row.cost_cap_daily,
    costCapMonthly: row.cost_cap_monthly,
    maxTokensPerCall: row.max_tokens_per_call,
    settings: JSON.parse(row.settings || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Get config for a specific agent. Returns null if not set.
 */
export function getAgentConfig(agentId: string): AgentConfig | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM agent_config WHERE agent_id = ?').get(agentId) as ConfigRow | undefined
  return row ? rowToConfig(row) : null
}

/**
 * List all agent configs, optionally filtered by team.
 */
export function listAgentConfigs(opts?: { teamId?: string }): AgentConfig[] {
  const db = getDb()
  if (opts?.teamId) {
    const rows = db.prepare('SELECT * FROM agent_config WHERE team_id = ? ORDER BY agent_id').all(opts.teamId) as ConfigRow[]
    return rows.map(rowToConfig)
  }
  const rows = db.prepare('SELECT * FROM agent_config ORDER BY agent_id').all() as ConfigRow[]
  return rows.map(rowToConfig)
}

/**
 * Set (upsert) config for an agent.
 */
export function setAgentConfig(agentId: string, updates: {
  teamId?: string
  model?: string | null
  fallbackModel?: string | null
  costCapDaily?: number | null
  costCapMonthly?: number | null
  maxTokensPerCall?: number | null
  settings?: Record<string, unknown>
}): AgentConfig {
  const db = getDb()
  const now = Date.now()
  const existing = getAgentConfig(agentId)

  if (existing) {
    // Update
    const model = updates.model !== undefined ? updates.model : existing.model
    const fallbackModel = updates.fallbackModel !== undefined ? updates.fallbackModel : existing.fallbackModel
    const costCapDaily = updates.costCapDaily !== undefined ? updates.costCapDaily : existing.costCapDaily
    const costCapMonthly = updates.costCapMonthly !== undefined ? updates.costCapMonthly : existing.costCapMonthly
    const maxTokensPerCall = updates.maxTokensPerCall !== undefined ? updates.maxTokensPerCall : existing.maxTokensPerCall
    const settings = updates.settings !== undefined ? updates.settings : existing.settings
    const teamId = updates.teamId ?? existing.teamId

    db.prepare(`
      UPDATE agent_config SET
        team_id = ?, model = ?, fallback_model = ?, cost_cap_daily = ?,
        cost_cap_monthly = ?, max_tokens_per_call = ?, settings = ?, updated_at = ?
      WHERE agent_id = ?
    `).run(teamId, model, fallbackModel, costCapDaily, costCapMonthly, maxTokensPerCall, JSON.stringify(settings), now, agentId)

    return { agentId, teamId, model, fallbackModel, costCapDaily, costCapMonthly, maxTokensPerCall, settings, createdAt: existing.createdAt, updatedAt: now }
  }

  // Insert
  const teamId = updates.teamId ?? 'default'
  const model = updates.model ?? null
  const fallbackModel = updates.fallbackModel ?? null
  const costCapDaily = updates.costCapDaily ?? null
  const costCapMonthly = updates.costCapMonthly ?? null
  const maxTokensPerCall = updates.maxTokensPerCall ?? null
  const settings = updates.settings ?? {}

  db.prepare(`
    INSERT INTO agent_config (agent_id, team_id, model, fallback_model, cost_cap_daily, cost_cap_monthly, max_tokens_per_call, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(agentId, teamId, model, fallbackModel, costCapDaily, costCapMonthly, maxTokensPerCall, JSON.stringify(settings), now, now)

  return { agentId, teamId, model, fallbackModel, costCapDaily, costCapMonthly, maxTokensPerCall, settings, createdAt: now, updatedAt: now }
}

/**
 * Delete config for an agent.
 */
export function deleteAgentConfig(agentId: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM agent_config WHERE agent_id = ?').run(agentId)
  return result.changes > 0
}

/**
 * Check if an agent is within its cost cap.
 * Returns { allowed, remaining, cap, spent, action } for the cost enforcement hook.
 */
export function checkCostCap(agentId: string, currentDailySpend: number, currentMonthlySpend: number): {
  allowed: boolean
  dailyRemaining: number | null
  monthlyRemaining: number | null
  action: 'allow' | 'warn' | 'downgrade' | 'deny'
  model: string | null
  fallbackModel: string | null
} {
  const config = getAgentConfig(agentId)
  if (!config) {
    return { allowed: true, dailyRemaining: null, monthlyRemaining: null, action: 'allow', model: null, fallbackModel: null }
  }

  let action: 'allow' | 'warn' | 'downgrade' | 'deny' = 'allow'
  let dailyRemaining: number | null = null
  let monthlyRemaining: number | null = null

  if (config.costCapDaily !== null) {
    dailyRemaining = config.costCapDaily - currentDailySpend
    if (dailyRemaining <= 0) {
      action = 'deny'
    } else if (dailyRemaining < config.costCapDaily * 0.1) {
      action = 'downgrade' // < 10% remaining → use fallback model
    } else if (dailyRemaining < config.costCapDaily * 0.2) {
      action = action === 'allow' ? 'warn' : action // < 20% remaining → warn
    }
  }

  if (config.costCapMonthly !== null) {
    monthlyRemaining = config.costCapMonthly - currentMonthlySpend
    if (monthlyRemaining <= 0) {
      action = 'deny'
    } else if (monthlyRemaining < config.costCapMonthly * 0.1 && action !== 'deny') {
      action = 'downgrade'
    } else if (monthlyRemaining < config.costCapMonthly * 0.2 && action === 'allow') {
      action = 'warn'
    }
  }

  return {
    allowed: action !== 'deny',
    dailyRemaining,
    monthlyRemaining,
    action,
    model: config.model,
    fallbackModel: config.fallbackModel,
  }
}

