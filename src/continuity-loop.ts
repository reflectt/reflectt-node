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
import { presenceManager } from './presence.js'
import { getAgentRolesSource, getAgentRole } from './assignment.js'
import { runProductObservation } from './product-observation-source.js'

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
const lastNudgeAt: Record<string, number> = {}
const NUDGE_COOLDOWN_MS = 5 * 60_000 // 5 min — separate from task-replenish cooldown

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

function resolveMonitoredAgents(configAgents: string[]): string[] {
  const trimmed = (configAgents || []).map(a => String(a || '').trim()).filter(Boolean)

  // If no agents explicitly configured, auto-discover from real runtime presence.
  // This avoids creating tasks for placeholder agents (e.g. agent-1/2/3) on fresh installs.
  if (trimmed.length === 0) {
    return presenceManager
      .getAllPresence()
      .filter(p => p.status !== 'offline')
      .map(p => p.agent)
      .filter(Boolean)
  }

  // If we are running with built-in placeholder roles (no TEAM-ROLES.yaml found),
  // only target agents that have actually checked in via presence.
  const rolesSource = getAgentRolesSource().source
  if (rolesSource === 'builtin') {
    return trimmed.filter(a => Boolean(presenceManager.getPresence(a)))
  }

  // Otherwise, allow configured agents, but still prefer skipping totally unknown agents.
  return trimmed
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
  const now = Date.now()

  // Always record the tick when the loop is enabled so /continuity/stats reflects
  // real scheduler activity even on no-op cycles (e.g. zero agents configured).
  if (config.enabled) {
    stats.cyclesRun++
    stats.lastRunAt = now
  }

  const monitoredAgents = resolveMonitoredAgents(config.agents)

  if (!config.enabled || monitoredAgents.length === 0) {
    return { actions: [], agentsChecked: 0, replenished: 0 }
  }

  const cooldownMs = config.cooldownMin * 60_000
  const actions: ContinuityAction[] = []
  let replenished = 0

  for (const agent of monitoredAgents) {
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

    // Cold-start path: if no insights exist at all and agent has never had tasks,
    // bootstrap with scoped onboarding tasks so the loop has something to build from.
    const bootstrap = await bootstrapColdStart(agent, deficit, config, now)
    if (bootstrap.length > 0) {
      lastReplenishAt[agent] = now
      replenished += bootstrap.length
      actions.push(...bootstrap)
      continue
    }

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
      // No insights to promote.
      // Run nudges and scoped-task generation in parallel — they serve different purposes:
      //   nudges seed the future insights pipeline (async, future cycles)
      //   scoped tasks fill the immediate queue (synchronous, this cycle)
      // Previously, scoped tasks were gated behind nudgeResult.total === 0, which meant
      // active teams (where nudges always fire) never reached the scoped fallback.
      let createdTasks = false

      // 1. Fire reflection nudges (respects its own 5-min cooldown to prevent spam)
      const nudgeCooledDown = !lastNudgeAt[agent] || now - lastNudgeAt[agent] >= NUDGE_COOLDOWN_MS
      if (nudgeCooledDown) {
        try {
          const nudgeResult = await tickReflectionNudges()
          if (nudgeResult.total > 0) {
            stats.reflectionNudgesFired += nudgeResult.total
            lastNudgeAt[agent] = now
            const action: ContinuityAction = {
              id: `cl-nudge-${agent}-${now}`,
              kind: 'reflection-nudge-triggered',
              agent,
              detail: `Queue below floor (${unblockedTodo.length}/${config.minReady}). No promotable insights. Fired ${nudgeResult.total} reflection nudge(s) to seed pipeline.`,
              timestamp: now,
            }
            recordAction(action)
            actions.push(action)
          }
        } catch { /* non-fatal */ }
      }

      // 2. Independently attempt scoped task generation from role config
      try {
        const scopedActions = await generateScopedTasksFromRole(agent, deficit, config, now)
        if (scopedActions.length > 0) {
          lastReplenishAt[agent] = now
          replenished += scopedActions.length
          createdTasks = true
          actions.push(...scopedActions)
          try {
            const taskIds = scopedActions.map(a => a.taskId).filter(Boolean).join(', ')
            await routeMessage({
              from: 'system',
              content: `🔄 Continuity loop: generated ${scopedActions.length} scoped task(s) for @${agent} from role context (insights pool was empty). Tasks: ${taskIds}`,
              category: 'continuity-loop',
              severity: 'info',
              forceChannel: config.channel,
            })
          } catch { /* non-fatal */ }
        }
      } catch {
        stats.noCandidateCycles++
      }

      if (!createdTasks) {
        stats.noCandidateCycles++
        const action: ContinuityAction = {
          id: `cl-empty-${agent}-${now}`,
          kind: 'no-candidates',
          agent,
          detail: `Queue below floor (${unblockedTodo.length}/${config.minReady}). No promotable insights and no scoped tasks could be generated. Nudges fired to seed pipeline.`,
          timestamp: now,
        }
        recordAction(action)
        actions.push(action)
        // No full cooldown when nothing was created — allow retry on next tick.
        // Nudge spam is handled by the separate lastNudgeAt cooldown above.

        // Product observation: when queue is empty + no insights, probe the live
        // product and emit findings as reflections to seed the insight pipeline.
        // Gated on: recent ship in last 4h + 30m cooldown per agent.
        try {
          const obsResult = await runProductObservation(agent)
          if (!obsResult.skipped && obsResult.reflectionsCreated > 0) {
            console.log(`[continuity-loop] product-observation: ${agent} — ${obsResult.reflectionsCreated} reflection(s) created from ${obsResult.findings.length} finding(s)`)
          }
        } catch (err) {
          console.warn(`[continuity-loop] product-observation failed for ${agent}:`, (err as Error).message)
        }
      }
    }
  }

  return { actions, agentsChecked: monitoredAgents.length, replenished }
}

// ── Cold-start bootstrap ──────────────────────────────────────────────────
//
// When an agent has no promoted insights AND has never had a continuity task
// created for them before, the replenishment loop would silently produce nothing.
// This breaks onboarding for new teams (agents repeat status forever).
//
// Bootstrap fires exactly once per agent: when the continuity audit has zero
// prior entries for the agent AND there are no promotable insights.
// It creates scoped starter tasks so the loop has something to build from.

const BOOTSTRAP_TASKS: Array<{ title: string; description: string; done_criteria: string[] }> = [
  {
    title: 'Orient to your role and team',
    description: 'Read your SOUL.md / AGENTS.md, explore the task board, and write a short note in your workspace about what you own and what your first real deliverable is.',
    done_criteria: [
      'SOUL.md / AGENTS.md reviewed',
      'First real deliverable identified and written in workspace notes',
      'At least one existing task or PR reviewed to understand current team state',
    ],
  },
  {
    title: 'Run a smoke test against the running server',
    description: 'Verify the local server is healthy: hit /health, /tasks, and any endpoint relevant to your lane. Document what you find.',
    done_criteria: [
      'GET /health returns 200',
      'GET /tasks returns a valid list',
      'Any lane-specific endpoints verified or flagged if missing',
      'Findings noted in a task comment',
    ],
  },
  {
    title: 'File your first real task from a concrete observation',
    description: 'Find one real problem, gap, or improvement opportunity you can own. File it as a properly scoped task with done criteria, assignee, reviewer, and eta.',
    done_criteria: [
      'One real task filed (not a placeholder)',
      'Task has explicit done criteria',
      'Task is in todo status with assignee and reviewer set',
    ],
  },
]

async function bootstrapColdStart(
  agent: string,
  count: number,
  config: ContinuityConfig,
  now: number,
): Promise<ContinuityAction[]> {
  // Guard: only bootstrap if this agent has zero continuity audit entries ever
  const existing = getContinuityAuditFromDb({ agent, limit: 1 })
  if (existing.length > 0) return []

  // Guard: also check if agent already has any tasks on the board (not truly cold)
  const existingTasks = taskManager.listTasks({ assignee: agent })
  if (existingTasks.length > 0) return []

  const actions: ContinuityAction[] = []
  const toCreate = BOOTSTRAP_TASKS.slice(0, Math.min(count, BOOTSTRAP_TASKS.length))

  for (const template of toCreate) {
    try {
      const task = await taskManager.createTask({
        title: template.title,
        description: template.description,
        status: 'todo',
        assignee: agent,
        reviewer: config.defaultReviewer,
        priority: 'P2',
        createdBy: 'continuity-loop',
        eta: '1 day',
        done_criteria: template.done_criteria,
        metadata: {
          lane: 'onboarding',
          bootstrap: true,
          bootstrap_reason: 'cold_start_no_insights',
          bootstrap_at: now,
        },
      } as any)

      if (task?.id) {
        stats.insightsPromoted++ // reuse counter as "tasks created"
        const action: ContinuityAction = {
          id: `cl-bootstrap-${agent}-${now}-${task.id}`,
          kind: 'queue-replenish',
          agent,
          detail: `Cold-start bootstrap: created onboarding task "${template.title}" (${task.id}) for agent with no prior insights or tasks.`,
          taskId: task.id,
          timestamp: now,
        }
        recordAction(action)
        actions.push(action)
      }
    } catch (err) {
      console.warn(`[ContinuityLoop] Bootstrap task creation failed for ${agent}:`, err)
    }
  }

  if (actions.length > 0) {
    routeMessage({
      from: 'system',
      forceChannel: config.channel,
      content: `🚀 Continuity bootstrap: @${agent} has no prior tasks or insights. Created ${actions.length} onboarding task(s) to get the queue started.`,
      category: 'continuity-loop',
    }).catch(() => {})
  }

  return actions
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

// ── Role-derived task generation (fallback when insights pool is dry) ──

/**
 * Generates scoped placeholder tasks for an agent based on their role and
 * the current state of the task board. Used when the insights pool is empty
 * and reflection nudges have nothing to fire.
 *
 * Tasks are lightweight but actionable — enough context to start work.
 * Deduplication guard: skips creation if a near-identical task already exists.
 */
async function generateScopedTasksFromRole(
  agent: string,
  count: number,
  config: ContinuityConfig,
  now: number,
): Promise<ContinuityAction[]> {
  const actions: ContinuityAction[] = []
  const role = getAgentRole(agent)
  if (!role) return actions

  // Build candidate tasks from:
  //   1. Stalled doing tasks assigned to this agent (been doing for >24h, no recent activity)
  //   2. Done tasks from this agent that may need follow-up (done_criteria partially met)
  //   3. Role affinity tags → look for open work in those tags that's unassigned
  const candidates: Array<{ title: string; description: string; priority: string; tags: string[] }> = []

  // 1. Stalled doing tasks → generate "unblock / continue" tasks
  const stalledDoing = taskManager.listTasks({ status: 'doing', assignee: agent })
  for (const t of stalledDoing.slice(0, 2)) {
    const ageH = (now - new Date(t.updatedAt).getTime()) / 3_600_000
    if (ageH > 24) {
      candidates.push({
        title: `Follow up on stalled task: ${t.title.slice(0, 60)}`,
        description: `Task ${t.id} has been in "doing" for ${Math.round(ageH)}h with no updates. Review blockers, update status, or split into smaller steps.`,
        priority: t.priority ?? 'P2',
        tags: [...(role.affinityTags ?? []), 'continuity-generated'],
      })
    }
  }

  // 2. Role affinity tags → find unassigned todo tasks that match this agent's domain
  if (candidates.length < count && role.affinityTags?.length > 0) {
    const allTodo = taskManager.listTasks({ status: 'todo' })
    const unassigned = allTodo.filter(t => !t.assignee || t.assignee === '')
    for (const t of unassigned) {
      const taskTags: string[] = (t.metadata as any)?.tags ?? []
      const match = role.affinityTags.some(tag => taskTags.includes(tag))
      if (match) {
        candidates.push({
          title: `Claim and start: ${t.title.slice(0, 60)}`,
          description: `Unassigned task ${t.id} matches your role (${role.role}). Claim it, set up context, and begin work.`,
          priority: t.priority ?? 'P2',
          tags: [...(role.affinityTags ?? []), 'continuity-generated'],
        })
        if (candidates.length >= count) break
      }
    }
  }

  // 3. Generic role-based maintenance task if still short
  if (candidates.length < count) {
    candidates.push({
      title: `${role.role} maintenance cycle — review open work and update task board`,
      description: `Your queue is empty. As ${role.role}: review any open issues, check for unreported blockers, update stale task statuses, and identify next highest-value work in your domain (${(role.affinityTags ?? []).join(', ')}).`,
      priority: 'P2',
      tags: [...(role.affinityTags ?? []), 'continuity-generated', 'maintenance'],
    })
  }

  // Create tasks, dedup by title prefix
  const existingTitles = taskManager.listTasks({ assignee: agent, status: 'todo' }).map(t => t.title.slice(0, 40).toLowerCase())

  for (const candidate of candidates.slice(0, count)) {
    const titleKey = candidate.title.slice(0, 40).toLowerCase()
    if (existingTitles.includes(titleKey)) continue // dedup guard

    try {
      const task = await taskManager.createTask({
        title: candidate.title,
        description: candidate.description,
        assignee: agent,
        reviewer: config.defaultReviewer,
        status: 'todo',
        priority: candidate.priority as 'P0' | 'P1' | 'P2' | 'P3',
        done_criteria: ['Task reviewed and either completed, re-scoped, or handed off with clear next steps'],
        createdBy: 'continuity-loop',
        metadata: {
          source: 'continuity-loop',
          generated_at: now,
          generated_reason: 'role-scoped-fallback',
          tags: candidate.tags,
        },
      })
      stats.insightsPromoted++ // reuse counter — represents "auto-generated" broadly
      const action: ContinuityAction = {
        id: `cl-scoped-${agent}-${task.id}-${now}`,
        kind: 'queue-replenish',
        agent,
        detail: `Generated scoped task from role "${role.role}" (affinity: ${(role.affinityTags ?? []).join(', ')}): "${task.title}"`,
        taskId: task.id,
        timestamp: now,
      }
      recordAction(action)
      actions.push(action)
    } catch (err) {
      console.warn(`[ContinuityLoop] Failed to generate scoped task for ${agent}:`, err)
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
  for (const key of Object.keys(lastNudgeAt)) delete lastNudgeAt[key]
  stats = {
    cyclesRun: 0,
    insightsPromoted: 0,
    reflectionNudgesFired: 0,
    noCandidateCycles: 0,
    lastRunAt: null,
  }
}
