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

// Dedup guards for tiered escalation (SIGNAL-ROUTING Change 2)
// mention fires at most once per 24h per agent; escalate at most once per 48h.
// task-1773525631162-cjxch4mrz
const mentionLastAt: Record<string, number> = {}
const escalateLastAt: Record<string, number> = {}
const MENTION_DEDUP_MS = 24 * 60 * 60 * 1000
const ESCALATE_DEDUP_MS = 48 * 60 * 60 * 1000

export type ReflectionTier = 'none' | 'digest' | 'mention' | 'escalate' | 'immediate'

/**
 * 4-tier reflection reminder decision per SIGNAL-ROUTING Change 2 spec.
 *
 * | Overdue    | Tier      | Channel |
 * |------------|-----------|---------|
 * | < 14h      | none      | —       |
 * | 14h–24h    | digest    | #ops (batched, no @mention) |
 * | 24h–48h    | mention   | #ops with @mention, once per 24h |
 * | 48h+       | escalate  | #ops with @kai, once per 48h |
 * | post-task  | immediate | #general direct to agent |
 */
export function getReflectionTier(
  agent: string,
  lastReflectionAt: number,
  justCompletedTask: boolean,
  nowMs = Date.now(),
): ReflectionTier {
  if (justCompletedTask) return 'immediate'

  const overdueMs = nowMs - lastReflectionAt
  const overdueHours = overdueMs / (1000 * 60 * 60)

  if (overdueHours < 14) return 'none'
  if (overdueHours < 24) return 'digest'

  if (overdueHours < 48) {
    // mention: dedup to once per 24h
    const lastMention = mentionLastAt[agent] ?? 0
    if (nowMs - lastMention < MENTION_DEDUP_MS) return 'none'
    mentionLastAt[agent] = nowMs // record on selection so dispatch doesn't double-set
    return 'mention'
  }

  // escalate: dedup to once per 48h
  const lastEscalate = escalateLastAt[agent] ?? 0
  if (nowMs - lastEscalate < ESCALATE_DEDUP_MS) return 'none'
  escalateLastAt[agent] = nowMs // record on selection
  return 'escalate'
}

/** Exposed for tests — reset dedup state between test runs */
export function _resetTierDedupForTest(): void {
  for (const k of Object.keys(mentionLastAt)) delete mentionLastAt[k]
  for (const k of Object.keys(escalateLastAt)) delete escalateLastAt[k]
}

/**
 * Dispatch a reflection reminder based on the computed tier.
 * digest → batchNag (existing batch-before-post gate, Change 4)
 * mention/escalate → immediate routeMessage to #ops
 * immediate → routeMessage to #general direct to agent
 */
export async function dispatchReflectionTier(
  agent: string,
  tier: ReflectionTier,
  hoursSince: number,
  lastReflectionAt: number,
  config: ReflectionNudgeConfig,
): Promise<void> {
  const opsChannel = 'ops'
  const now = Date.now()

  switch (tier) {
    case 'none':
      return

    case 'digest':
      // Add to ops batch — batchNag handles flush (Change 4)
      batchNag(opsChannel, `@${agent}: reflection ${hoursSince}h overdue — submit when you can`)
      return

    case 'mention': {
      // mentionLastAt already set in getReflectionTier
      const msg = `🪞 @${agent} reflection overdue ${hoursSince}h — submit when you have a moment. POST /reflections.`
      await routeMessage({ from: 'system', content: msg, category: 'watchdog-alert', severity: 'warning', forceChannel: opsChannel }).catch(() => {})
      return
    }

    case 'escalate': {
      // escalateLastAt already set in getReflectionTier
      const lastDate = lastReflectionAt > 0 ? new Date(lastReflectionAt).toISOString().slice(0, 10) : 'never'
      const msg = `🚨 @kai @${agent} reflection overdue ${hoursSince}h. Last reflection: ${lastDate}. Needs attention.`
      await routeMessage({ from: 'system', content: msg, category: 'watchdog-alert', severity: 'critical', forceChannel: opsChannel }).catch(() => {})
      return
    }

    case 'immediate': {
      const msg = `🪞 @${agent} task complete — good moment to reflect. POST /reflections.`
      batchNag(config.channel || 'general', msg)
      return
    }
  }
}

/** Running guard — prevents concurrent tick calls from firing duplicate nudges */
let _tickRunning = false

/**
 * Seed lastNudgeAt from DB so that process restarts don't trigger immediate re-nudges.
 * Called lazily on first tick.
 */
let _seeded = false
function seedLastNudgeAtFromDb(): void {
  if (_seeded) return
  _seeded = true
  try {
    ensureReflectionTrackingTable()
    const db = getDb()
    const rows = db.prepare('SELECT agent, last_nudge_at FROM reflection_tracking WHERE last_nudge_at IS NOT NULL').all() as { agent: string; last_nudge_at: number }[]
    for (const row of rows) {
      if (!lastNudgeAt[row.agent] || row.last_nudge_at > lastNudgeAt[row.agent]) {
        lastNudgeAt[row.agent] = row.last_nudge_at
      }
    }
  } catch { /* db may not be ready */ }
}

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
  // Guard: skip if a tick is already in progress (prevents concurrent callers from
  // firing duplicate nudges before lastNudgeAt is updated).
  if (_tickRunning) return { postTaskNudges: 0, idleNudges: 0, total: 0 }
  _tickRunning = true

  // Seed lastNudgeAt from DB on first call (survives process restarts)
  seedLastNudgeAtFromDb()

  try {
    return await _doTick()
  } finally {
    _tickRunning = false
  }
}

async function _doTick(): Promise<{
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
  // v1.1 autonomy hardening: include agents that are *tracked* (have reflection_tracking rows)
  // even if they currently have no active tasks. This reduces human-trigger dependence.
  const agents = getNudgeAgents(config)

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
      // 4-tier dispatch per SIGNAL-ROUTING Change 2
      const tier = getReflectionTier(agent, lastReflection, false, now)
      if (tier !== 'none') {
        await dispatchReflectionTier(agent, tier, hoursSinceDisplay, lastReflection, config)
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

// ── Batch-before-post gate (SIGNAL-ROUTING Change 4) ─────────────────────────
// All per-agent nags (reflection reminders, idle alerts) go through batchNag()
// before any channel post. A 5-minute batch window accumulates messages; the
// flush posts a single Noise Budget Digest instead of N individual posts.
//
// Window duration controlled by WATCHDOG_BATCH_WINDOW_MS env var (default 5min).
// Tests can set WATCHDOG_BATCH_WINDOW_MS to a small value (e.g. 50ms).
//
// task-1773525646527-rgpsta72u

export function getBatchWindowMs(): number {
  const envVal = process.env.WATCHDOG_BATCH_WINDOW_MS
  if (envVal) return Number(envVal)
  return 5 * 60 * 1000 // 5 minutes (production default)
}

// Exported for testing — allows tests to flush the batch manually
export const _nagBatch: Map<string, string[]> = new Map() // channel → messages
let _batchTimer: ReturnType<typeof setTimeout> | null = null

export function _flushNagBatch(): void {
  for (const [channel, messages] of _nagBatch.entries()) {
    if (messages.length === 0) continue
    const content = `📋 **Reflection & Idle Digest** (${messages.length} reminder${messages.length !== 1 ? 's' : ''}):\n${messages.map(m => `• ${m}`).join('\n')}`
    routeMessage({
      from: 'system',
      content,
      category: 'watchdog-alert',
      severity: 'info',
      forceChannel: channel,
    }).catch(() => { /* non-fatal */ })
  }
  _nagBatch.clear()
  _batchTimer = null
}

function batchNag(channel: string, message: string): void {
  const existing = _nagBatch.get(channel)
  if (existing) {
    existing.push(message)
  } else {
    _nagBatch.set(channel, [message])
  }

  if (!_batchTimer) {
    _batchTimer = setTimeout(_flushNagBatch, getBatchWindowMs())
  }
}

// ── Nudge messages ──

async function sendPostTaskNudge(agent: string, taskId: string, taskTitle: string, config: ReflectionNudgeConfig, taskStatus?: string): Promise<void> {
  const isBlocked = taskStatus === 'blocked'
  const msg = isBlocked
    ? `🪞 @${agent}: "${taskTitle}" (${taskId}) is blocked — reflect on what's blocking you`
    : `🪞 @${agent}: completed "${taskTitle}" (${taskId}) — what went well, what was painful?`

  batchNag(config.channel || 'general', msg)
}

async function sendIdleNudge(agent: string, hoursSince: number, tasksDone: number, config: ReflectionNudgeConfig): Promise<void> {
  const taskNote = tasksDone > 0 ? ` (${tasksDone} task(s) done since last reflection)` : ''
  const msg = `🪞 @${agent}: ${hoursSince}h since last reflection${taskNote} — capture what you've learned`

  batchNag(config.channel || 'general', msg)
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

/**
 * Return list of agents eligible for reflection nudges.
 *
 * If policy specifies an explicit agent allowlist, that is used.
 * Otherwise we take the union of:
 * - agents with active tasks (doing/todo/validating)
 * - agents with reflection tracking rows (previously reflected / previously nudged)
 *
 * This closes a real autonomy gap: an agent can drift out of the active-task set,
 * stop reflecting, and never get nudged — requiring a human to re-trigger them.
 */
function getNudgeAgents(config: ReflectionNudgeConfig): string[] {
  ensureReflectionTrackingTable()
  const db = getDb()

  const tracked = (db.prepare('SELECT agent FROM reflection_tracking').all() as any[])
    .map(r => String(r.agent))

  // Allowlist semantics: if policy specifies explicit agents[], treat it as strict.
  // Only when agents[] is empty do we auto-discover and union in tracked rows.
  const hasAllowlist = config.agents.length > 0

  const base = hasAllowlist
    ? config.agents
    : getActiveAgents(config.excludeAgents)

  const all = hasAllowlist
    ? base
    : [...new Set([...base, ...tracked])]

  const excludeSet = new Set((config.excludeAgents || []).map(a => a.toLowerCase()))
  return all.filter(agent => {
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
