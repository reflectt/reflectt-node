// SPDX-License-Identifier: Apache-2.0
// Agent configuration API — model preference + cost cap per agent
import { getDb } from './db.js'
import { getAgentRoles } from './assignment.js'

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

/* ─── Avatar generation + seeding ─── */

const KNOWN_AGENTS: Record<string, { emoji: string; color: string }> = {
  kai:     { emoji: '🤖', color: '#3b57e8' },
  link:    { emoji: '🔗', color: '#8b5cf6' },
  pixel:   { emoji: '🎨', color: '#ec4899' },
  claude:  { emoji: '🧩', color: '#d97706' },
  echo:    { emoji: '📝', color: '#f59e0b' },
  sage:    { emoji: '🧠', color: '#10b981' },
  rhythm:  { emoji: '🥁', color: '#ef4444' },
  scout:   { emoji: '🔍', color: '#0ea5e9' },
  harmony: { emoji: '🫶', color: '#a855f7' },
  spark:   { emoji: '🚀', color: '#fb923c' },
}

function hashStr(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const GEN_HUES = [210, 280, 340, 30, 160, 60, 190, 310, 120, 250]

function genColor(name: string): string {
  return `hsl(${GEN_HUES[hashStr(name) % GEN_HUES.length]}, 65%, 55%)`
}

function generateAvatarSvg(name: string): string {
  const ln = name.toLowerCase()
  const known = KNOWN_AGENTS[ln]
  const color = known?.color || genColor(ln)
  const emoji = known?.emoji || ln[0]?.toUpperCase() || '?'
  const h = hashStr(ln)

  // Generate 3-5 geometric shapes
  const count = 3 + (h % 3)
  let shapes = ''
  for (let i = 0; i < count; i++) {
    const seed = hashStr(`${ln}-shape-${i}`)
    const x = 10 + ((seed >> 4) % 80)
    const y = 10 + ((seed >> 8) % 80)
    const size = 12 + ((seed >> 12) % 25)
    const opacity = 0.15 + ((seed >> 16) % 30) / 100
    const rotation = (seed >> 20) % 360
    const type = seed % 3

    if (type === 0) {
      shapes += `<circle cx="${x}" cy="${y}" r="${size / 2}" fill="${color}" opacity="${opacity}" transform="rotate(${rotation} ${x} ${y})"/>`
    } else if (type === 1) {
      shapes += `<rect x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" rx="${size * 0.15}" fill="${color}" opacity="${opacity}" transform="rotate(${rotation} ${x} ${y})"/>`
    } else {
      const half = size / 2
      shapes += `<polygon points="${x},${y - half} ${x - half},${y + half * 0.6} ${x + half},${y + half * 0.6}" fill="${color}" opacity="${opacity}" transform="rotate(${rotation} ${x} ${y})"/>`
    }
  }

  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="bg-${ln}" x1="0%" y1="0%" x2="100%" y2="100%">
<stop offset="0%" stop-color="${color}" stop-opacity="0.15"/>
<stop offset="100%" stop-color="${color}" stop-opacity="0.05"/>
</linearGradient></defs>
<circle cx="50" cy="50" r="50" fill="url(#bg-${ln})"/>
${shapes}
<text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="40">${emoji}</text>
</svg>`
}

function ensureAgentAvatar(agentId: string): boolean {
  const existing = getAgentConfig(agentId)
  const currentAvatar = (existing?.settings as Record<string, unknown> | undefined)?.avatar as Record<string, unknown> | undefined
  if (typeof currentAvatar?.content === 'string' && currentAvatar.content.trim()) return false

  const settings = { ...(existing?.settings || {}) } as Record<string, unknown>
  settings.avatar = {
    type: 'svg',
    content: generateAvatarSvg(agentId),
    updatedAt: Date.now(),
    source: 'bootstrap-seed',
  }

  setAgentConfig(agentId, {
    teamId: existing?.teamId ?? 'default',
    model: existing?.model,
    fallbackModel: existing?.fallbackModel,
    costCapDaily: existing?.costCapDaily,
    costCapMonthly: existing?.costCapMonthly,
    maxTokensPerCall: existing?.maxTokensPerCall,
    settings,
  })
  return true
}

/**
 * Seed avatars for agent IDs provided by a TEAM-ROLES materialization event,
 * or for all currently loaded roles when called without arguments.
 */
export function seedAgentAvatars(agentIds?: string[]): number {
  const targets = Array.isArray(agentIds) && agentIds.length > 0
    ? agentIds
    : getAgentRoles().map(role => role.name)

  let seeded = 0
  for (const agentId of targets) {
    if (!agentId) continue
    if (ensureAgentAvatar(agentId)) seeded++
  }

  if (seeded > 0) {
    console.log(`[AgentConfig] Seeded avatars for ${seeded} agent(s)`)
  }
  return seeded
}
