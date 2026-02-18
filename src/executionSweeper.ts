// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Execution Sweeper — Zero-Leak Enforcement
 * 
 * Periodically scans for:
 * 1. Stale validating tasks (no reviewer activity within SLA)
 * 2. Open PRs not linked to active tasks
 * 3. Task/PR state drift (merged PR but task still validating)
 * 
 * Escalates via chat messages to #blockers when thresholds are breached.
 */

import { taskManager } from './tasks.js'
import { chatManager } from './chat.js'
import type { Task } from './types.js'

// ── Configuration ──────────────────────────────────────────────────────────

/** How often the sweeper runs (ms) */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/** Validating SLA: escalate after this many ms without reviewer activity */
const VALIDATING_SLA_MS = 30 * 60 * 1000 // 30 minutes

/** Critical SLA: second escalation tier */
const VALIDATING_CRITICAL_MS = 60 * 60 * 1000 // 60 minutes

/** Track which tasks we've already escalated (avoid spam) */
const escalated = new Map<string, { level: 'warning' | 'critical'; at: number }>()

/** Track sweep stats for the /execution-health endpoint */
let lastSweepAt = 0
let lastSweepResults: SweepResult | null = null

export interface SweepViolation {
  taskId: string
  title: string
  assignee?: string
  reviewer?: string
  type: 'validating_sla' | 'validating_critical' | 'pr_drift' | 'orphan_pr'
  age_minutes: number
  message: string
}

export interface SweepResult {
  timestamp: number
  violations: SweepViolation[]
  tasksScanned: number
  validatingCount: number
}

// ── Core Sweep Logic ───────────────────────────────────────────────────────

export function sweepValidatingQueue(): SweepResult {
  const now = Date.now()
  const allTasks = taskManager.listTasks()
  const validating = allTasks.filter((t: Task) => t.status === 'validating')
  const violations: SweepViolation[] = []

  for (const task of validating) {
    const meta = (task.metadata || {}) as Record<string, unknown>
    const enteredAt = (meta.entered_validating_at as number) || task.updatedAt
    const lastActivity = (meta.review_last_activity_at as number) || enteredAt
    const ageSinceActivity = now - lastActivity
    const ageMinutes = Math.round(ageSinceActivity / 60_000)

    const prev = escalated.get(task.id)

    if (ageSinceActivity >= VALIDATING_CRITICAL_MS && prev?.level !== 'critical') {
      violations.push({
        taskId: task.id,
        title: task.title,
        assignee: task.assignee,
        reviewer: task.reviewer,
        type: 'validating_critical',
        age_minutes: ageMinutes,
        message: `🚨 CRITICAL: "${task.title}" stuck in validating for ${ageMinutes}m. Reviewer: ${task.reviewer || 'none'}. Assignee: ${task.assignee || 'none'}. This is blocking flow.`,
      })
      escalated.set(task.id, { level: 'critical', at: now })
    } else if (ageSinceActivity >= VALIDATING_SLA_MS && !prev) {
      violations.push({
        taskId: task.id,
        title: task.title,
        assignee: task.assignee,
        reviewer: task.reviewer,
        type: 'validating_sla',
        age_minutes: ageMinutes,
        message: `⚠️ SLA breach: "${task.title}" in validating ${ageMinutes}m without reviewer action. @${task.reviewer || 'unassigned'} — review or escalate now.`,
      })
      escalated.set(task.id, { level: 'warning', at: now })
    }
  }

  // Clean up escalation tracking for tasks no longer validating
  for (const [taskId] of escalated) {
    const task = allTasks.find((t: Task) => t.id === taskId)
    if (!task || task.status !== 'validating') {
      escalated.delete(taskId)
    }
  }

  const result: SweepResult = {
    timestamp: now,
    violations,
    tasksScanned: allTasks.length,
    validatingCount: validating.length,
  }

  lastSweepAt = now
  lastSweepResults = result

  return result
}

// ── Escalation ─────────────────────────────────────────────────────────────

async function escalateViolations(violations: SweepViolation[]): Promise<void> {
  if (violations.length === 0) return

  for (const v of violations) {
    // Post to general channel for visibility
    try {
      await chatManager.sendMessage({
        channel: 'general',
        from: 'sweeper',
        content: v.message,
      })
    } catch {
      // Chat might not be ready — log only
      console.warn(`[Sweeper] Could not post escalation for ${v.taskId}`)
    }
  }

  console.log(`[Sweeper] Escalated ${violations.length} violation(s):`,
    violations.map(v => `${v.type}:${v.taskId}`).join(', '))
}

// ── PR-State Drift Detection ───────────────────────────────────────────────

/**
 * Check if a task's linked PR has been merged but the task is still in validating.
 * Called externally when PR state changes are detected.
 */
export function flagPrDrift(taskId: string, prState: 'merged' | 'closed'): SweepViolation | null {
  const lookup = taskManager.resolveTaskId(taskId)
  if (!lookup.task) return null

  const task = lookup.task
  if (task.status === 'done') return null // Already done, no drift

  if (prState === 'merged' && task.status === 'validating') {
    return {
      taskId: task.id,
      title: task.title,
      assignee: task.assignee,
      reviewer: task.reviewer,
      type: 'pr_drift',
      age_minutes: 0,
      message: `📦 PR merged but task "${task.title}" still in validating. Auto-advancing to ready-for-close.`,
    }
  }

  if (prState === 'closed' && task.status !== 'blocked') {
    return {
      taskId: task.id,
      title: task.title,
      assignee: task.assignee,
      reviewer: task.reviewer,
      type: 'pr_drift',
      age_minutes: 0,
      message: `🔴 PR closed (not merged) for task "${task.title}". Task should be blocked or have replacement PR.`,
    }
  }

  return null
}

// ── Periodic Runner ────────────────────────────────────────────────────────

let sweepTimer: ReturnType<typeof setInterval> | null = null

export function startSweeper(): void {
  if (sweepTimer) return

  console.log(`[Sweeper] Starting execution sweeper (interval: ${SWEEP_INTERVAL_MS / 1000}s, SLA: ${VALIDATING_SLA_MS / 60_000}m, critical: ${VALIDATING_CRITICAL_MS / 60_000}m)`)

  // Run once immediately
  const initial = sweepValidatingQueue()
  escalateViolations(initial.violations)

  sweepTimer = setInterval(() => {
    try {
      const result = sweepValidatingQueue()
      escalateViolations(result.violations)
    } catch (err) {
      console.error('[Sweeper] Sweep failed:', err)
    }
  }, SWEEP_INTERVAL_MS)

  sweepTimer.unref()
}

export function stopSweeper(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}

export function getSweeperStatus(): {
  running: boolean
  lastSweepAt: number
  lastResults: SweepResult | null
  escalationTracking: Array<{ taskId: string; level: string; at: number }>
} {
  return {
    running: sweepTimer !== null,
    lastSweepAt,
    lastResults: lastSweepResults,
    escalationTracking: Array.from(escalated.entries()).map(([taskId, e]) => ({
      taskId,
      level: e.level,
      at: e.at,
    })),
  }
}
