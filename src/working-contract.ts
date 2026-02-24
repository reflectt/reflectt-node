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
import { countReflections } from './reflections.js'
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

// ── State: track warnings ──

const warningTimestamps: Map<string, number> = new Map() // key: `${agent}:${taskId}`

// ── Enforcement tick ──

/**
 * Called periodically. Checks all 'doing' tasks for stale status.
 * Phase 1: warn. Phase 2 (after grace): auto-requeue.
 */
export async function tickWorkingContract(): Promise<TickResult> {
  const config = getConfig()
  if (!config.enabled) return { warnings: 0, requeued: 0, actions: [] }

  const now = Date.now()
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
        warningTimestamps.delete(warningKey)
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
      warningTimestamps.delete(warningKey)

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
