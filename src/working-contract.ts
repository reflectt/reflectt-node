// SPDX-License-Identifier: Apache-2.0
// Working Contract Enforcement
//
// Replaces conversational nudges with hard product-level enforcement:
//   1. Auto-requeue: tasks in 'doing' with no status comment past threshold → auto back to 'todo'
//   2. Reflection gate: agents with overdue reflections cannot claim new 'doing' tasks
//   3. Warning before requeue: one warning, then grace period, then enforce
//
// This is enforcement, not reminders. Tasks move. Gates block.

import { getDb } from './db.js'
import { taskManager } from './tasks.js'
import { policyManager } from './policy.js'
import { routeMessage } from './messageRouter.js'
import { listReflections } from './reflections.js'
import { getEffectiveActivity, formatActivityWarning, type ActivitySignal } from './activity-signal.js'

// ── Types ──

export interface WorkingContractConfig {
  enabled: boolean
  staleAutoRequeueMin: number
  graceAfterWarningMin: number
  reflectionGateOnClaim: boolean
  agents: string[]
  channel: string
  dryRun: boolean
}

export interface EnforcementAction {
  type: 'warning' | 'auto_requeue' | 'reflection_gate_block'
  agent: string
  taskId: string
  taskTitle: string
  reason: string
  timestamp: number
  dryRun: boolean
}

export interface TickResult {
  warnings: number
  requeued: number
  actions: EnforcementAction[]
}

export interface ClaimGateResult {
  allowed: boolean
  reason?: string
  gate?: 'reflection_overdue'
  reflectionsDue?: number
}

// ── Startup grace period ──

/**
 * After a process restart, doing tasks that were already in-flight should
 * not be immediately eligible for auto-requeue. Agents need time to reconnect
 * and post a status update. During this window Phase 1 warnings are also
 * suppressed to avoid thundering-herd noise.
 *
 * Root cause of the "restart re-queues doing tasks" bug:
 * - boardHealthWorker calls tickWorkingContract() on every health tick.
 * - On restart, doing tasks may have been stale for hours (agent was offline).
 * - Without a grace period, the contract fires immediately and requeues them.
 * - This clears the agent's active task, breaking their work context.
 *
 * Fix: suppress Phase 1 + Phase 2 enforcement for STARTUP_GRACE_MS after
 * module load (which proxies server start time).
 */
export const STARTUP_GRACE_MS = 15 * 60 * 1000 // 15 minutes

/** Timestamp when this module was first loaded (proxy for server start) */
const moduleLoadedAt = Date.now()

// ── State: track warnings ──

/**
 * warningTimestamps: key → epoch ms when Phase 1 warning was issued.
 *
 * Backed by SQLite so restarts don't re-fire warnings. In-memory cache
 * is seeded from DB on first use.
 *
 * Root cause of compliance snapshot 3x bug: this was previously a plain
 * in-memory Map that reset on every server restart. Each restart would
 * re-fire the Phase 1 warning for every stale doing task. The stale
 * duration increments between restarts (e.g. "stale for 45m" vs "46m"),
 * which bypassed chat.ts content dedup, resulting in 2–3x identical-
 * looking warning messages per agent per deploy cycle.
 */
const warningTimestamps: Map<string, number> = new Map()
let _warningDbSeeded = false

function ensureWarningTable(): void {
  const db = getDb()
  db.prepare(`
    CREATE TABLE IF NOT EXISTS wc_warning_timestamps (
      key TEXT PRIMARY KEY,
      warned_at INTEGER NOT NULL
    )
  `).run()
}

function seedWarningTimestamps(): void {
  if (_warningDbSeeded) return
  _warningDbSeeded = true
  try {
    ensureWarningTable()
    const db = getDb()
    const rows = db.prepare('SELECT key, warned_at FROM wc_warning_timestamps').all() as { key: string; warned_at: number }[]
    for (const row of rows) {
      warningTimestamps.set(row.key, row.warned_at)
    }
  } catch { /* db may not be ready */ }
}

function persistWarning(key: string, timestamp: number): void {
  try {
    ensureWarningTable()
    const db = getDb()
    db.prepare('INSERT OR REPLACE INTO wc_warning_timestamps (key, warned_at) VALUES (?, ?)').run(key, timestamp)
  } catch { /* best-effort */ }
}

function clearWarning(key: string): void {
  warningTimestamps.delete(key)
  try {
    const db = getDb()
    db.prepare('DELETE FROM wc_warning_timestamps WHERE key = ?').run(key)
  } catch { /* best-effort */ }
}

// ── Enforcement tick ──

/**
 * Called periodically. Checks all 'doing' tasks for stale status.
 * Phase 1: warn. Phase 2 (after grace): auto-requeue.
 */
export async function tickWorkingContract(opts: {
  /** @internal test-only: override Date.now() */
  _nowOverride?: number
  /** @internal test-only: override moduleLoadedAt */
  _moduleLoadedAtOverride?: number
} = {}): Promise<TickResult> {
  const config = getConfig()
  if (!config.enabled) return { warnings: 0, requeued: 0, actions: [] }

  // Seed warningTimestamps from DB on first tick (survives process restarts)
  seedWarningTimestamps()

  const now = opts._nowOverride ?? Date.now()
  const effectiveModuleLoadedAt = opts._moduleLoadedAtOverride ?? moduleLoadedAt

  // Startup grace period: suppress auto-requeue for STARTUP_GRACE_MS after server start.
  // Agents need time to reconnect and post a status update after a restart.
  // Without this, doing tasks that were in-flight before the restart get immediately
  // re-queued on the first board health tick, wiping agents' active work context.
  const uptimeMs = now - effectiveModuleLoadedAt
  const inGracePeriod = uptimeMs < STARTUP_GRACE_MS
  if (inGracePeriod) {
    return { warnings: 0, requeued: 0, actions: [] }
  }
  const staleThresholdMs = config.staleAutoRequeueMin * 60_000
  const graceMs = config.graceAfterWarningMin * 60_000
  const actions: EnforcementAction[] = []
  let warnings = 0
  let requeued = 0

  // Get all tasks in 'doing'
  const doingTasks = taskManager.listTasks({ status: 'doing' })

  for (const task of doingTasks) {
    const agent = task.assignee
    if (!agent) continue
    if (config.agents.length > 0 && !config.agents.includes(agent)) continue
    if (isExcludedAgent(agent)) continue

    // Use canonical activity signal (comments + state transitions, not updatedAt)
    const activitySignal = getEffectiveActivity(task.id, agent, task.createdAt || now)
    const effectiveLastAt = activitySignal.effectiveActivityTs
    const staleDurationMs = now - effectiveLastAt

    if (staleDurationMs < staleThresholdMs) continue

    const warningKey = `${agent}:${task.id}`
    const warnedAt = warningTimestamps.get(warningKey)

    if (!warnedAt) {
      // Phase 1: Issue warning
      warningTimestamps.set(warningKey, now)
      persistWarning(warningKey, now)
      const signalInfo = formatActivityWarning(activitySignal, config.staleAutoRequeueMin, now)
      const action: EnforcementAction = {
        type: 'warning',
        agent,
        taskId: task.id,
        taskTitle: task.title,
        reason: `Stale: ${signalInfo}. Task will auto-requeue in ${config.graceAfterWarningMin}m if no update.`,
        timestamp: now,
        dryRun: config.dryRun,
      }
      actions.push(action)
      warnings++

      if (!config.dryRun) {
        await routeMessage({
          from: 'system',
          content: `⚠️ [Product Enforcement] @${agent}, task ${task.id} ("${task.title.slice(0, 60)}") — ${signalInfo}. **Post a status comment within ${config.graceAfterWarningMin}m or the task will auto-requeue to todo.** (This is automated — no leadership action needed.)`,
          category: 'watchdog-alert',
          severity: 'warning',
          forceChannel: config.channel,
          taskId: task.id,
          mentions: [agent],
        }).catch(() => {})
      }
    } else if (now - warnedAt >= graceMs) {
      // Phase 2: Check if agent posted since warning
      const activitySinceWarning = getLastActivityForAgent(task.id, agent)
      if (activitySinceWarning && activitySinceWarning > warnedAt) {
        // Agent responded — clear warning
        clearWarning(warningKey)
        continue
      }

      // Auto-requeue
      const action: EnforcementAction = {
        type: 'auto_requeue',
        agent,
        taskId: task.id,
        taskTitle: task.title,
        reason: `No activity after warning. Auto-requeued from doing → todo.`,
        timestamp: now,
        dryRun: config.dryRun,
      }
      actions.push(action)
      requeued++
      clearWarning(warningKey)

      if (!config.dryRun) {
        try {
          // Move task back to todo, clear assignee
          const db = getDb()
          db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
            .run('todo', now, task.id)

          // Post enforcement comment (goes through TaskManager for comms_policy enforcement + audit)
          await taskManager.addTaskComment(
            task.id,
            'system',
            `🔄 [Product Enforcement] Auto-requeued: no status update from @${agent} after warning. Task moved back to todo. (Automated — no leadership action needed.)`,
          )

          await routeMessage({
            from: 'system',
            content: `🔄 **[Product Enforcement] Auto-requeued**: ${task.id} ("${task.title.slice(0, 60)}") moved from doing → todo. @${agent} did not respond within ${config.graceAfterWarningMin}m. (Automated enforcement — no leadership intervention required.)`,
            category: 'watchdog-alert',
            severity: 'warning',
            forceChannel: config.channel,
            taskId: task.id,
            mentions: [agent],
          }).catch(() => {})
        } catch (err) {
          console.error(`[WorkingContract] Auto-requeue failed for ${task.id}:`, err)
        }
      }
    }
  }

  return { warnings, requeued, actions }
}

// ── Claim gate: reflection enforcement ──

/**
 * Check if an agent is allowed to claim a task (move to 'doing').
 * Blocks if agent has overdue reflections.
 */
export function checkClaimGate(agent: string): ClaimGateResult {
  const config = getConfig()
  if (!config.enabled || !config.reflectionGateOnClaim) {
    return { allowed: true }
  }

  // Check reflection SLA
  const db = getDb()
  try {
    // Ensure table exists (created by reflection-automation, but may not be loaded yet)
    db.exec(`
      CREATE TABLE IF NOT EXISTS reflection_tracking (
        agent TEXT PRIMARY KEY,
        last_reflection_at INTEGER,
        last_nudge_at INTEGER,
        tasks_done_since_reflection INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `)
    const tracking = db.prepare('SELECT * FROM reflection_tracking WHERE agent = ?').get(agent) as any
    if (!tracking) return { allowed: true } // no tracking row = no enforcement yet

    const lastReflection = tracking.last_reflection_at || 0
    const tasksDone = tracking.tasks_done_since_reflection || 0

    // Block if: completed 2+ tasks since last reflection and it's been >4 hours
    const hoursSinceReflection = lastReflection > 0
      ? (Date.now() - lastReflection) / (1000 * 60 * 60)
      : Infinity

    if (tasksDone >= 2 && hoursSinceReflection > 4) {
      // Reconciliation: if reflections exist in the reflections table but the tracking row is stale
      // (e.g., reflections ingested via a path that didn't call onReflectionSubmitted), do not
      // permanently lock the agent out of claiming work.
      try {
        const latest = listReflections({ author: agent, limit: 1 })[0]
        const latestAt = latest?.created_at
        if (typeof latestAt === 'number' && latestAt > lastReflection) {
          // Treat this as a missed tracking reset; sync the tracking row and allow.
          const now = Date.now()
          db.prepare(`
            INSERT INTO reflection_tracking (agent, last_reflection_at, tasks_done_since_reflection, updated_at)
            VALUES (?, ?, 0, ?)
            ON CONFLICT(agent) DO UPDATE SET
              last_reflection_at = ?,
              tasks_done_since_reflection = 0,
              updated_at = ?
          `).run(agent, latestAt, now, latestAt, now)
          return { allowed: true }
        }
      } catch {
        // ignore reconciliation errors; fall through to block
      }

      return {
        allowed: false,
        reason: `Reflection gate: ${tasksDone} tasks completed since last reflection (${lastReflection > 0 ? Math.floor(hoursSinceReflection) + 'h ago' : 'never'}). Submit a reflection via POST /reflections before claiming new work.`,
        gate: 'reflection_overdue',
        reflectionsDue: tasksDone,
      }
    }
  } catch {
    // Table may not exist yet
  }

  return { allowed: true }
}

// ── Helpers ──

function getConfig(): WorkingContractConfig {
  const policy = policyManager.get()
  return (policy as any).workingContract ?? {
    enabled: true,
    staleAutoRequeueMin: 90,
    graceAfterWarningMin: 15,
    reflectionGateOnClaim: true,
    agents: [],
    channel: 'general',
    dryRun: false,
  }
}

function getLastActivityForAgent(taskId: string, agent: string): number | null {
  try {
    const db = getDb()
    const row = db.prepare(
      'SELECT MAX(timestamp) as latest FROM task_comments WHERE task_id = ? AND author = ? AND (suppressed IS NULL OR suppressed = 0)'
    ).get(taskId, agent) as { latest: number | null } | undefined
    return row?.latest ?? null
  } catch {
    return null
  }
}

const EXCLUDED_PATTERNS = [/^test-/i, /^system$/i, /^bot$/i, /^sweeper$/i]

function isExcludedAgent(agent: string): boolean {
  return EXCLUDED_PATTERNS.some(p => p.test(agent))
}

// ── Test helpers ──

export function _clearWarnings(): void {
  warningTimestamps.clear()
}

export function _getWarnings(): Map<string, number> {
  return new Map(warningTimestamps)
}
