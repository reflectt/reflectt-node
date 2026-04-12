// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Todo Hoarding Guard
 *
 * Prevents idle agents from holding too many todo tasks:
 *   Rule A — Cap: if assignee.todo > TODO_CAP && assignee.doing == 0 &&
 *            last_activity > IDLE_THRESHOLD_MS, auto-unassign lowest-priority
 *            todos beyond top TODO_CAP.
 *   Rule B — Orphan: mark todos held by idle/offline agents as orphaned
 *            so they don't count toward ready-floor supply.
 *   Rule C — Claim: /tasks/next?claim=1 auto-transitions todo→doing.
 */

import { taskManager } from './tasks.js'
import type { Task } from './types.js'

// ── Config ─────────────────────────────────────────────────────────────────

/** Max todo tasks per agent before auto-unassign kicks in */
export const TODO_CAP = 3

/** Agent must be idle for this long (no doing tasks + no activity) before unassign */
export const IDLE_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Startup grace period: skip auto-unassignment for this long after server start.
 *
 * Root cause of the "gateway restart clears assignees" bug:
 * After a server/gateway restart, all agents are temporarily disconnected.
 * The hoarding sweep uses task.updatedAt for idle detection — if tasks were
 * last updated >30m ago, agents appear idle immediately on startup. The sweep
 * then mass-unassigns their overflow todos before agents can reconnect.
 *
 * Fix: suppress Rule A (auto-unassign) during the grace period so agents have
 * time to reconnect and resume work. Rule B (orphan tagging) still runs.
 */
export const STARTUP_GRACE_MS = 10 * 60 * 1000 // 10 minutes

/** Timestamp when this module was first loaded (proxy for server start) */
const moduleLoadedAt = Date.now()

/** Priority ordering (lower index = higher priority, kept first) */
const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3']

// ── Types ──────────────────────────────────────────────────────────────────

export interface HoardingAction {
  taskId: string
  taskTitle: string
  previousAssignee: string
  reason: string
}

export interface OrphanedTodo {
  taskId: string
  taskTitle: string
  assignee: string
  idleMinutes: number
}

export interface HoardingSweepResult {
  unassigned: HoardingAction[]
  orphaned: OrphanedTodo[]
  scanned: number
  timestamp: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function priorityRank(p: string): number {
  const idx = PRIORITY_ORDER.indexOf(p)
  return idx >= 0 ? idx : PRIORITY_ORDER.length
}

/**
 * Get the most recent activity timestamp for an agent.
 * Activity = last task update.
 */
function getAgentLastActivity(agent: string, allTasks: Task[]): number {
  let latest = 0

  for (const t of allTasks) {
    if (t.assignee?.toLowerCase() !== agent.toLowerCase()) continue
    const ts = typeof t.updatedAt === 'number' ? t.updatedAt : 0
    if (ts > latest) latest = ts
  }

  return latest
}

// ── Core Logic ─────────────────────────────────────────────────────────────

/**
 * Run the hoarding sweep. Returns actions taken (or would be taken in dry-run).
 */
export async function sweepTodoHoarding(opts: {
  dryRun?: boolean
  /** @internal test-only: override Date.now() */
  _nowOverride?: number
  /** @internal test-only: override moduleLoadedAt */
  _moduleLoadedAtOverride?: number
} = {}): Promise<HoardingSweepResult> {
  const { dryRun = false, _nowOverride, _moduleLoadedAtOverride } = opts
  const now = _nowOverride ?? Date.now()
  const effectiveModuleLoadedAt = _moduleLoadedAtOverride ?? moduleLoadedAt
  const allTasks = taskManager.listTasks() as Task[]

  // Startup grace period: suppress auto-unassignment (Rule A) while agents reconnect.
  // Rule B (orphan detection) is read-only and safe to run immediately.
  const uptimeMs = now - effectiveModuleLoadedAt
  const inGracePeriod = uptimeMs < STARTUP_GRACE_MS

  // Group by assignee
  const byAssignee = new Map<string, { todo: Task[]; doing: Task[] }>()

  for (const t of allTasks) {
    if (!t.assignee || t.assignee === 'unassigned') continue
    const agent = t.assignee.toLowerCase()
    if (!byAssignee.has(agent)) byAssignee.set(agent, { todo: [], doing: [] })
    const bucket = byAssignee.get(agent)!

    if (t.status === 'todo') bucket.todo.push(t)
    else if (t.status === 'doing') bucket.doing.push(t)
  }

  const unassigned: HoardingAction[] = []
  const orphaned: OrphanedTodo[] = []

  for (const [agent, { todo, doing }] of byAssignee) {
    const lastActivity = getAgentLastActivity(agent, allTasks)
    const idleMs = now - lastActivity

    // Rule B: orphan detection — flag todos held by agents with 0 doing AND idle
    if (doing.length === 0 && todo.length > 0 && idleMs >= IDLE_THRESHOLD_MS) {
      for (const t of todo) {
        orphaned.push({
          taskId: t.id,
          taskTitle: t.title || '',
          assignee: agent,
          idleMinutes: Math.round(idleMs / 60000),
        })
      }
    }

    // Rule A: auto-unassign overflow
    // Skip during startup grace period — agents may not have reconnected yet
    if (inGracePeriod) continue
    // Skip agents actively doing work
    if (doing.length > 0) continue
    // Skip agents with todo at or below cap
    if (todo.length <= TODO_CAP) continue
    // Only unassign if idle beyond threshold
    if (idleMs < IDLE_THRESHOLD_MS) continue

    // Sort by priority (keep highest priority), then by createdAt (keep newest)
    const sorted = [...todo].sort((a, b) => {
      const pDiff = priorityRank(a.priority || 'P3') - priorityRank(b.priority || 'P3')
      if (pDiff !== 0) return pDiff
      // Same priority: keep more recently created
      return (b.createdAt || 0) - (a.createdAt || 0)
    })

    // Keep top TODO_CAP, unassign the rest
    const toUnassign = sorted.slice(TODO_CAP)

    for (const task of toUnassign) {
      // Skip pinned tasks
      if (task.metadata?.pinned) continue

      const reason = `Auto-unassigned: ${agent} held ${todo.length} todos with 0 doing and ${Math.round(idleMs / 60000)}m idle (cap: ${TODO_CAP})`

      if (!dryRun) {
        await taskManager.updateTask(task.id, {
          assignee: 'unassigned',
        })
        // Add comment for audit trail
        await taskManager.addTaskComment(task.id, 'system', `🔄 ${reason}`)
      }

      unassigned.push({
        taskId: task.id,
        taskTitle: task.title || '',
        previousAssignee: agent,
        reason,
      })
    }
  }

  return {
    unassigned,
    orphaned,
    scanned: allTasks.length,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Claim a task: transition from todo → doing when fetched via /tasks/next.
 * Returns the updated task or null if transition fails.
 */
export async function claimTask(taskId: string, agent: string): Promise<Task | null> {
  const task = taskManager.getTask(taskId)
  if (!task) return null
  if (task.status !== 'todo') return null

  const updated = await taskManager.updateTask(taskId, {
    status: 'doing',
    assignee: agent,
    metadata: {
      ...(task.metadata || {}),
      eta: '~60m (auto-claimed)',
      lane_override: true, // auto-claim bypasses lane validation — agents claim what the system assigns
    },
  })

  if (updated) {
    await taskManager.addTaskComment(taskId, 'system', `📋 Auto-claimed by ${agent} via /tasks/next?claim=1`)
  }

  return updated || null
}
