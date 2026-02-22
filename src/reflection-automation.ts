// SPDX-License-Identifier: Apache-2.0
// Reflection automation — nudges agents to self-reflect after task completion
// and on idle cadence. Tracks reflection SLA per agent.

import { getDb, safeJsonStringify, safeJsonParse } from './db.js'
import { taskManager } from './tasks.js'
import type { Task } from './types.js'
import { routeMessage } from './messageRouter.js'
import { policyManager } from './policy.js'
import { countReflections, listReflections } from './reflections.js'

// ── Types ──

export interface ReflectionNudgeConfig {
  enabled: boolean
  /** Nudge agent after task moves to done (minutes to wait before nudging) */
  postTaskDelayMin: number
  /** Nudge if agent hasn't reflected in this many hours */
  idleReflectionHours: number
  /** Minimum hours between nudges to same agent */
  cooldownMin: number
  /** Agents to monitor (empty = all active agents) */
  agents: string[]
  /** Channel for nudge delivery */
  channel: string
  /** Per-role cadence overrides: { engineering: 4, ops: 8 } hours */
  roleCadenceHours: Record<string, number>
  /** Agent names to exclude from auto-discovery (test agents, system, etc.) */
  excludeAgents?: string[]
  /** Nudge agents who have never reflected (default: true) */
  nudgeNeverReflected?: boolean
}

export interface ReflectionSLA {
  agent: string
  lastReflectionAt: number | null
  lastNudgeAt: number | null
  tasksDoneSinceLastReflection: number
  hoursOverdue: number | null
  status: 'healthy' | 'due' | 'overdue'
}

interface PendingNudge {
  agent: string
  taskId: string
  taskTitle: string
  taskStatus: string
  doneAt: number
  nudgeAt: number // when to fire the nudge
}

// ── State ──

const pendingNudges: PendingNudge[] = []
const lastNudgeAt: Record<string, number> = {}

// ── Table ──

export function ensureReflectionTrackingTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS reflection_tracking (
      agent TEXT PRIMARY KEY,
      last_reflection_at INTEGER,
      last_nudge_at INTEGER,
      tasks_done_since_reflection INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `)
}

// ── Core: task completion hook ──

/**
 * Called when a task transitions to done. Queues a reflection nudge.
 */
export function onTaskDone(task: Task): void {
  const config = getConfig()
  if (!config.enabled) return

  const agent = task.assignee
  if (!agent) return
  if (config.agents.length > 0 && !config.agents.includes(agent)) return

  // Increment tasks-done counter
  ensureReflectionTrackingTable()
  const db = getDb()
  db.prepare(`
    INSERT INTO reflection_tracking (agent, tasks_done_since_reflection, updated_at)
    VALUES (?, 1, ?)
    ON CONFLICT(agent) DO UPDATE SET
      tasks_done_since_reflection = tasks_done_since_reflection + 1,
      updated_at = ?
  `).run(agent, Date.now(), Date.now())

  // Queue nudge after delay
  const nudgeAt = Date.now() + config.postTaskDelayMin * 60_000
  pendingNudges.push({
    agent,
    taskId: task.id,
    taskTitle: task.title,
    taskStatus: task.status,
    doneAt: Date.now(),
    nudgeAt,
  })
}

/**
 * Called when a reflection is submitted. Resets the agent's tracking.
 */
export function onReflectionSubmitted(agent: string): void {
  ensureReflectionTrackingTable()
  const db = getDb()
  db.prepare(`
    INSERT INTO reflection_tracking (agent, last_reflection_at, tasks_done_since_reflection, updated_at)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(agent) DO UPDATE SET
      last_reflection_at = ?,
      tasks_done_since_reflection = 0,
      updated_at = ?
  `).run(agent, Date.now(), Date.now(), Date.now(), Date.now())
}

// ── Tick: process pending nudges + idle checks ──

/**
 * Called periodically (e.g., every 5 min by board health worker).
 * Fires queued post-task nudges and checks idle reflection SLA.
 */
export async function tickReflectionNudges(): Promise<{
  postTaskNudges: number
  idleNudges: number
  total: number
}> {
  const config = getConfig()
  if (!config.enabled) return { postTaskNudges: 0, idleNudges: 0, total: 0 }

  let postTaskNudges = 0
  let idleNudges = 0
  const now = Date.now()
  const cooldownMs = config.cooldownMin * 60_000

  // Process pending post-task nudges
  const ready = pendingNudges.filter(n => now >= n.nudgeAt)
  for (const nudge of ready) {
    const idx = pendingNudges.indexOf(nudge)
    if (idx >= 0) pendingNudges.splice(idx, 1)

    // Check cooldown
    if (lastNudgeAt[nudge.agent] && now - lastNudgeAt[nudge.agent] < cooldownMs) continue

    // Check if agent already reflected since task completion
    const tracking = getAgentTracking(nudge.agent)
    if (tracking && tracking.last_reflection_at && tracking.last_reflection_at > nudge.doneAt) continue

    await sendPostTaskNudge(nudge.agent, nudge.taskId, nudge.taskTitle, config, nudge.taskStatus)
    lastNudgeAt[nudge.agent] = now
    postTaskNudges++
  }

  // Check idle reflection SLA
  const agents = config.agents.length > 0
    ? config.agents
    : getActiveAgents(config.excludeAgents)

  const nudgeNeverReflected = config.nudgeNeverReflected !== false // default true

  for (const agent of agents) {
    if (lastNudgeAt[agent] && now - lastNudgeAt[agent] < cooldownMs) continue

    // Seed tracking row for newly discovered agents
    ensureAgentTracking(agent)

    const tracking = getAgentTracking(agent)
    const lastReflection = tracking?.last_reflection_at || 0
    const cadenceHours = config.roleCadenceHours[agent] || config.idleReflectionHours

    let shouldNudge = false
    let hoursSinceDisplay = 0

    if (lastReflection > 0) {
      // Has reflected before — check if overdue
      const hoursSince = (now - lastReflection) / (1000 * 60 * 60)
      if (hoursSince >= cadenceHours) {
        shouldNudge = true
        hoursSinceDisplay = Math.floor(hoursSince)
      }
    } else if (nudgeNeverReflected) {
      // Never reflected — check if tracking row is old enough (seeded_at)
      const seededAt = tracking?.updated_at || 0
      const hoursSinceSeeded = seededAt > 0 ? (now - seededAt) / (1000 * 60 * 60) : cadenceHours
      if (hoursSinceSeeded >= cadenceHours) {
        shouldNudge = true
        hoursSinceDisplay = Math.floor(hoursSinceSeeded)
      }
    }

    if (shouldNudge) {
      await sendIdleNudge(agent, hoursSinceDisplay, tracking?.tasks_done_since_reflection || 0, config)
      lastNudgeAt[agent] = now

      // Record nudge in DB
      ensureReflectionTrackingTable()
      const db = getDb()
      db.prepare(`
        INSERT INTO reflection_tracking (agent, last_nudge_at, tasks_done_since_reflection, updated_at)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(agent) DO UPDATE SET
          last_nudge_at = ?,
          updated_at = ?
      `).run(agent, now, now, now, now)

      idleNudges++
    }
  }

  return { postTaskNudges, idleNudges, total: postTaskNudges + idleNudges }
}

// ── SLA reporting ──

export function getReflectionSLAs(): ReflectionSLA[] {
  ensureReflectionTrackingTable()
  const db = getDb()
  const config = getConfig()
  const now = Date.now()

  // Merge active agents + agents with tracking rows (union)
  const activeAgents = config.agents.length > 0 ? config.agents : getActiveAgents(config.excludeAgents)
  const trackedRows = db.prepare('SELECT agent FROM reflection_tracking').all() as { agent: string }[]
  const trackedAgents = trackedRows.map(r => r.agent)

  // Union, filtered by exclude patterns
  const excludeSet = new Set((config.excludeAgents || []).map(a => a.toLowerCase()))
  const allAgents = new Set([...activeAgents, ...trackedAgents])
  const agents = [...allAgents].filter(agent => {
    const lower = agent.toLowerCase()
    if (excludeSet.has(lower)) return false
    return !DEFAULT_EXCLUDE_PATTERNS.some(p => p.test(agent))
  })

  const slas: ReflectionSLA[] = []

  for (const agent of agents) {
    const tracking = getAgentTracking(agent)
    const lastReflection = tracking?.last_reflection_at || null
    const cadenceHours = config.roleCadenceHours[agent] || config.idleReflectionHours

    let hoursOverdue: number | null = null
    let status: ReflectionSLA['status'] = 'healthy'

    if (lastReflection) {
      const hoursSince = (now - lastReflection) / (1000 * 60 * 60)
      if (hoursSince >= cadenceHours * 1.5) {
        status = 'overdue'
        hoursOverdue = Math.round((hoursSince - cadenceHours) * 10) / 10
      } else if (hoursSince >= cadenceHours) {
        status = 'due'
        hoursOverdue = Math.round((hoursSince - cadenceHours) * 10) / 10
      }
    } else {
      // Never reflected
      status = 'overdue'
    }

    slas.push({
      agent,
      lastReflectionAt: lastReflection,
      lastNudgeAt: tracking?.last_nudge_at || null,
      tasksDoneSinceLastReflection: tracking?.tasks_done_since_reflection || 0,
      hoursOverdue,
      status,
    })
  }

  return slas.sort((a, b) => {
    const order = { overdue: 0, due: 1, healthy: 2 }
    return order[a.status] - order[b.status]
  })
}

// ── Nudge messages ──

async function sendPostTaskNudge(agent: string, taskId: string, taskTitle: string, config: ReflectionNudgeConfig, taskStatus?: string): Promise<void> {
  const isBlocked = taskStatus === 'blocked'
  const msg = isBlocked
    ? `🪞 Reflection nudge: @${agent}, "${taskTitle}" (${taskId}) is blocked. ` +
      `Take 2 min to reflect — what's blocking you, what did you try, and what would unblock it? ` +
      `Submit via POST /reflections with your observations.`
    : `🪞 Reflection nudge: @${agent}, you just completed "${taskTitle}" (${taskId}). ` +
      `Take 2 min to reflect — what went well, what was painful, and what would you change? ` +
      `Submit via POST /reflections with your observations.`

  try {
    await routeMessage({
      from: 'system',
      content: msg,
      category: 'watchdog-alert',
      severity: 'info',
      forceChannel: config.channel || 'general',
    })
  } catch { /* chat may not be available */ }
}

async function sendIdleNudge(agent: string, hoursSince: number, tasksDone: number, config: ReflectionNudgeConfig): Promise<void> {
  const taskNote = tasksDone > 0 ? ` You've completed ${tasksDone} task(s) since your last reflection.` : ''
  const msg = `🪞 Reflection due: @${agent}, it's been ${hoursSince}h since your last reflection.${taskNote} ` +
    `Take a moment to capture what you've learned. Submit via POST /reflections.`

  try {
    await routeMessage({
      from: 'system',
      content: msg,
      category: 'watchdog-alert',
      severity: 'warning',
      forceChannel: config.channel || 'general',
    })
  } catch { /* chat may not be available */ }
}

// ── Helpers ──

function getConfig(): ReflectionNudgeConfig {
  const policy = policyManager.get()
  return (policy as any).reflectionNudge ?? {
    enabled: true,
    postTaskDelayMin: 5,
    idleReflectionHours: 8,
    cooldownMin: 60,
    agents: [],
    channel: 'general',
    roleCadenceHours: {},
    excludeAgents: [],
    nudgeNeverReflected: true,
  }
}

function getAgentTracking(agent: string): {
  last_reflection_at: number | null
  last_nudge_at: number | null
  tasks_done_since_reflection: number
  updated_at: number
} | null {
  ensureReflectionTrackingTable()
  const db = getDb()
  return db.prepare('SELECT * FROM reflection_tracking WHERE agent = ?').get(agent) as any
}

/**
 * Ensure an agent has a tracking row (seed on first discovery).
 * This enables idle nudges for agents who have never reflected.
 */
function ensureAgentTracking(agent: string): void {
  ensureReflectionTrackingTable()
  const db = getDb()
  db.prepare(`
    INSERT OR IGNORE INTO reflection_tracking (agent, tasks_done_since_reflection, updated_at)
    VALUES (?, 0, ?)
  `).run(agent, Date.now())
}

/** Patterns that indicate non-real agents (test fixtures, system, etc.) */
const DEFAULT_EXCLUDE_PATTERNS = [
  /^test-/i,
  /^proof-/i,
  /^lane-/i,
  /^unassigned$/i,
  /^system$/i,
  /^bot$/i,
]

function getActiveAgents(excludeList?: string[]): string[] {
  // Get agents that have tasks in doing/todo/validating
  const tasks = taskManager.listTasks({})
  const agents = new Set<string>()
  for (const t of tasks) {
    if (t.assignee && ['doing', 'todo', 'validating'].includes(t.status)) {
      agents.add(t.assignee)
    }
  }

  // Filter out test/system agents
  const excludeSet = new Set((excludeList || []).map(a => a.toLowerCase()))
  return [...agents].filter(agent => {
    const lower = agent.toLowerCase()
    if (excludeSet.has(lower)) return false
    return !DEFAULT_EXCLUDE_PATTERNS.some(p => p.test(agent))
  })
}

// ── Test helpers ──

export function _clearReflectionTracking(): void {
  try {
    const db = getDb()
    db.prepare('DELETE FROM reflection_tracking').run()
  } catch { /* table may not exist */ }
  pendingNudges.length = 0
  for (const key of Object.keys(lastNudgeAt)) delete lastNudgeAt[key]
}

export function _getPendingNudges(): PendingNudge[] {
  return [...pendingNudges]
}
