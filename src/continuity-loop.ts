// SPDX-License-Identifier: Apache-2.0
// Autonomous team continuity loop
//
// Closes the gap between queue-floor breach → auto-replenishment:
//   1. Monitors agent queue floors (todo tasks)
//   2. When queue drops below floor, attempts to convert promoted insights → tasks
//   3. If no insights available, triggers reflection nudges to generate pipeline input
//   4. All actions logged to auditable timeline
//
// This removes the human push dependency for keeping agents fed with work.

import { taskManager } from './tasks.js'
import { policyManager } from './policy.js'
import { listInsights, type Insight } from './insights.js'
import { promoteInsight, type PromotionContract } from './insight-promotion.js'
import { generateRecurringCandidates } from './insight-promotion.js'
import { tickReflectionNudges } from './reflection-automation.js'
import { routeMessage } from './messageRouter.js'
import { getDb, safeJsonStringify, safeJsonParse } from './db.js'

// ── Types ──

export interface ContinuityAction {
  id: string
  kind: 'queue-replenish' | 'insight-promoted' | 'reflection-nudge-triggered' | 'no-candidates'
  agent: string
  detail: string
  insightId?: string
  taskId?: string
  timestamp: number
}

export interface ContinuityConfig {
  enabled: boolean
  /** Agents to monitor (defaults to policy readyQueueFloor.agents) */
  agents: string[]
  /** Minimum unblocked todo tasks per agent */
  minReady: number
  /** Maximum insights to auto-promote per cycle per agent */
  maxPromotePerCycle: number
  /** Cooldown between replenishment attempts per agent (minutes) */
  cooldownMin: number
  /** Default reviewer for auto-promoted tasks */
  defaultReviewer: string
  /** Channel for notifications */
  channel: string
}

export interface ContinuityStats {
  cyclesRun: number
  insightsPromoted: number
  reflectionNudgesFired: number
  noCandidateCycles: number
  lastRunAt: number | null
}

// ── State ──

const auditLog: ContinuityAction[] = []
const lastReplenishAt: Record<string, number> = {}

let stats: ContinuityStats = {
  cyclesRun: 0,
  insightsPromoted: 0,
  reflectionNudgesFired: 0,
  noCandidateCycles: 0,
  lastRunAt: null,
}

// ── DB table for persistent audit ──

export function ensureContinuityAuditTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS continuity_audit (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      agent TEXT NOT NULL,
      detail TEXT NOT NULL,
      insight_id TEXT,
      task_id TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_continuity_audit_ts ON continuity_audit(timestamp);
    CREATE INDEX IF NOT EXISTS idx_continuity_audit_agent ON continuity_audit(agent);
  `)
}

function recordAction(action: ContinuityAction): void {
  auditLog.push(action)
  // Keep in-memory log bounded
  if (auditLog.length > 500) auditLog.splice(0, auditLog.length - 500)

  try {
    ensureContinuityAuditTable()
    const db = getDb()
    db.prepare(`
      INSERT INTO continuity_audit (id, kind, agent, detail, insight_id, task_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(action.id, action.kind, action.agent, action.detail, action.insightId ?? null, action.taskId ?? null, action.timestamp)
  } catch {
    // Non-fatal — in-memory audit still works
  }
}

// ── Config ──

function getConfig(): ContinuityConfig {
  const policy = policyManager.get()
  const rqf = (policy as any).readyQueueFloor ?? {}
  return {
    enabled: (policy as any).continuityLoop?.enabled ?? true,
    agents: (policy as any).continuityLoop?.agents ?? rqf.agents ?? [],
    minReady: (policy as any).continuityLoop?.minReady ?? rqf.minReady ?? 2,
    maxPromotePerCycle: (policy as any).continuityLoop?.maxPromotePerCycle ?? 2,
    cooldownMin: (policy as any).continuityLoop?.cooldownMin ?? 30,
    defaultReviewer: (policy as any).continuityLoop?.defaultReviewer ?? 'sage',
    channel: (policy as any).continuityLoop?.channel ?? rqf.channel ?? 'general',
  }
}

// ── Core loop ──

/**
 * Run one continuity cycle. Called by boardHealthWorker tick.
 *
 * For each monitored agent:
 *   1. Count unblocked todo tasks
 *   2. If below floor, try to promote insights → tasks
 *   3. If no promotable insights, fire reflection nudges
 *   4. Log all actions
 */
export async function tickContinuityLoop(): Promise<{
  actions: ContinuityAction[]
  agentsChecked: number
  replenished: number
}> {
  const config = getConfig()
  if (!config.enabled || config.agents.length === 0) {
    return { actions: [], agentsChecked: 0, replenished: 0 }
  }

  const now = Date.now()
  const cooldownMs = config.cooldownMin * 60_000
  const actions: ContinuityAction[] = []
  let replenished = 0

  stats.cyclesRun++
  stats.lastRunAt = now

  for (const agent of config.agents) {
    // Cooldown check
    if (lastReplenishAt[agent] && now - lastReplenishAt[agent] < cooldownMs) continue

    // Count unblocked todo tasks
    const todoTasks = taskManager.listTasks({ status: 'todo', assignee: agent })
    const unblockedTodo = todoTasks.filter(t => {
      const blocked = (t.metadata as any)?.blocked_by
      if (!blocked) return true
      const blocker = taskManager.getTask(blocked as string)
      return !blocker || blocker.status === 'done'
    })

    if (unblockedTodo.length >= config.minReady) continue

    // Queue is below floor — attempt replenishment
    const deficit = config.minReady - unblockedTodo.length
    const promoted = await replenishFromInsights(agent, Math.min(deficit, config.maxPromotePerCycle), config, now)

    if (promoted.length > 0) {
      lastReplenishAt[agent] = now
      replenished += promoted.length
      actions.push(...promoted)

      // Notify
      const taskIds = promoted.map(a => a.taskId).filter(Boolean).join(', ')
      try {
        await routeMessage({
          from: 'system',
          content: `🔄 Continuity loop: auto-replenished @${agent}'s queue with ${promoted.length} task(s) from promoted insights. Tasks: ${taskIds}`,
          category: 'continuity-loop',
          severity: 'info',
          forceChannel: config.channel,
        })
      } catch { /* chat may not be available */ }
    } else {
      // No insights to promote — fire reflection nudges to generate pipeline input
      try {
        const nudgeResult = await tickReflectionNudges()
        if (nudgeResult.total > 0) {
          stats.reflectionNudgesFired += nudgeResult.total
          const action: ContinuityAction = {
            id: `cl-nudge-${agent}-${now}`,
            kind: 'reflection-nudge-triggered',
            agent,
            detail: `Queue below floor (${unblockedTodo.length}/${config.minReady}). No promotable insights. Fired ${nudgeResult.total} reflection nudge(s) to seed pipeline.`,
            timestamp: now,
          }
          recordAction(action)
          actions.push(action)
        } else {
          stats.noCandidateCycles++
          const action: ContinuityAction = {
            id: `cl-empty-${agent}-${now}`,
            kind: 'no-candidates',
            agent,
            detail: `Queue below floor (${unblockedTodo.length}/${config.minReady}). No promotable insights and no reflection nudges to fire. Manual task creation needed.`,
            timestamp: now,
          }
          recordAction(action)
          actions.push(action)
        }
      } catch {
        stats.noCandidateCycles++
      }

      lastReplenishAt[agent] = now // Still set cooldown to avoid spam
    }
  }

  return { actions, agentsChecked: config.agents.length, replenished }
}

// ── Insight → Task replenishment ──

async function replenishFromInsights(
  agent: string,
  count: number,
  config: ContinuityConfig,
  now: number,
): Promise<ContinuityAction[]> {
  const actions: ContinuityAction[] = []

  // Get promoted insights that don't have linked tasks yet
  const { insights } = listInsights({ status: 'promoted', limit: 20 })
  const candidates = insights.filter(i => !i.task_id)

  // Also check recurring candidates
  let recurring: Array<{ insight_id: string; suggested_owner: string | null }> = []
  try {
    recurring = generateRecurringCandidates()
  } catch { /* ok */ }

  // Merge candidates, prefer high-score first
  const allCandidates = [...candidates]
  for (const rc of recurring) {
    if (!allCandidates.find(c => c.id === rc.insight_id)) {
      const { insights: rcInsights } = listInsights({ limit: 1 })
      // Already included in the main list or not available
    }
  }

  // Sort by score descending
  allCandidates.sort((a, b) => b.score - a.score)

  for (const insight of allCandidates.slice(0, count)) {
    const contract: PromotionContract = {
      owner: agent,
      reviewer: config.defaultReviewer,
      eta: '3 days',
      acceptance_check: `Root cause from insight ${insight.id} addressed; follow-up reflection confirms fix`,
      artifact_proof_requirement: 'PR or config change linked to task',
      next_checkpoint_eta: '24h after assignment',
    }

    try {
      const result = await promoteInsight({ insight_id: insight.id, contract }, 'continuity-loop')
      if (result.success && result.task_id) {
        stats.insightsPromoted++
        const action: ContinuityAction = {
          id: `cl-promote-${insight.id}-${now}`,
          kind: 'insight-promoted',
          agent,
          detail: `Auto-promoted insight ${insight.id} (score: ${insight.score}, priority: ${insight.priority}) → task ${result.task_id} to replenish queue.`,
          insightId: insight.id,
          taskId: result.task_id,
          timestamp: now,
        }
        recordAction(action)
        actions.push(action)
      }
    } catch (err) {
      // Non-fatal — try next candidate
      console.warn(`[ContinuityLoop] Failed to promote insight ${insight.id}:`, err)
    }
  }

  return actions
}

// ── API helpers ──

export function getContinuityStats(): ContinuityStats {
  return { ...stats }
}

export function getContinuityAuditLog(limit = 50): ContinuityAction[] {
  return auditLog.slice(-limit)
}

export function getContinuityAuditFromDb(opts: { agent?: string; limit?: number; since?: number } = {}): ContinuityAction[] {
  try {
    ensureContinuityAuditTable()
    const db = getDb()
    const where: string[] = []
    const params: unknown[] = []

    if (opts.agent) { where.push('agent = ?'); params.push(opts.agent) }
    if (opts.since) { where.push('timestamp >= ?'); params.push(opts.since) }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const limit = Math.min(opts.limit ?? 50, 200)

    return db.prepare(
      `SELECT * FROM continuity_audit ${whereClause} ORDER BY timestamp DESC LIMIT ?`
    ).all(...params, limit) as ContinuityAction[]
  } catch {
    return []
  }
}

// ── Test helpers ──

export function _resetContinuityState(): void {
  auditLog.length = 0
  for (const key of Object.keys(lastReplenishAt)) delete lastReplenishAt[key]
  stats = {
    cyclesRun: 0,
    insightsPromoted: 0,
    reflectionNudgesFired: 0,
    noCandidateCycles: 0,
    lastRunAt: null,
  }
}
