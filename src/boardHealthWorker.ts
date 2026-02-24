// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Board-Health Execution Worker
 *
 * Automated board hygiene with full audit trail and rollback:
 * - Auto-block stale doing tasks (configurable threshold)
 * - Suggest close for abandoned tasks
 * - Emit periodic digest to chat
 * - Audit log for every automated action
 * - Rollback window for reversing decisions
 */

import { taskManager } from './tasks.js'
import { chatManager } from './chat.js'
import { routeMessage } from './messageRouter.js'
import { validateTaskTimestamp, verifyTaskExists } from './health.js'
import { policyManager } from './policy.js'
import type { Task } from './types.js'

// ── Types ──────────────────────────────────────────────────────────────────

export type PolicyActionKind =
  | 'auto-block-stale'
  | 'suggest-close'
  | 'digest-emitted'
  | 'auto-unassign-orphan'
  | 'ready-queue-warning'
  | 'idle-queue-escalation'
  | 'continuity-replenish'
  | 'auto-requeue'
  | 'working-contract-warning'

export interface PolicyAction {
  id: string
  kind: PolicyActionKind
  taskId: string | null
  agent: string | null
  description: string
  previousState: Record<string, unknown> | null
  appliedAt: number
  rolledBack: boolean
  rolledBackAt: number | null
  rollbackBy: string | null
}

export interface BoardHealthDigest {
  timestamp: number
  staleDoingCount: number
  suggestedCloseCount: number
  actionsApplied: number
  blockedTasks: string[]
  suggestedCloseTasks: string[]
  summary: string
}

export interface BoardHealthWorkerConfig {
  /** Enable/disable the worker (default: true) */
  enabled: boolean
  /** Tick interval in milliseconds (default: 5 min) */
  intervalMs: number
  /** Minutes without activity before a doing task is auto-blocked (default: 240 = 4h) */
  staleDoingThresholdMin: number
  /** Minutes without activity before suggesting close (default: 1440 = 24h) */
  suggestCloseThresholdMin: number
  /** Rollback window in milliseconds (default: 1h) */
  rollbackWindowMs: number
  /** Digest interval in milliseconds (default: 4h) */
  digestIntervalMs: number
  /** Channel for digest messages (default: 'ops') */
  digestChannel: string
  /** Quiet hours: don't act during these (HH format, 0-23) */
  quietHoursStart: number
  quietHoursEnd: number
  /** Dry run mode — log actions but don't execute (default: false) */
  dryRun: boolean
  /** Max actions per tick to prevent runaway automation (default: 5) */
  maxActionsPerTick: number
}

const DEFAULT_CONFIG: BoardHealthWorkerConfig = {
  enabled: true,
  intervalMs: 5 * 60 * 1000,       // 5 minutes
  staleDoingThresholdMin: 240,       // 4 hours
  suggestCloseThresholdMin: 1440,    // 24 hours
  rollbackWindowMs: 60 * 60 * 1000,  // 1 hour
  digestIntervalMs: 4 * 60 * 60 * 1000, // 4 hours
  digestChannel: 'ops',
  quietHoursStart: 0,
  quietHoursEnd: 6,
  dryRun: false,
  maxActionsPerTick: 5,
}

// ── Worker ─────────────────────────────────────────────────────────────────

export class BoardHealthWorker {
  private config: BoardHealthWorkerConfig
  private auditLog: PolicyAction[] = []
  private lastDigestAt = 0
  private lastTickAt = 0
  private tickCount = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(config?: Partial<BoardHealthWorkerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  start(): void {
    if (this.timer) return
    if (!this.config.enabled) return

    this.timer = setInterval(() => {
      this.tick().catch(() => {})
    }, this.config.intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  updateConfig(patch: Partial<BoardHealthWorkerConfig>): void {
    const wasEnabled = this.config.enabled
    this.config = { ...this.config, ...patch }

    // Restart timer if interval changed or enable toggled
    if (this.timer) {
      this.stop()
    }
    if (this.config.enabled) {
      this.start()
    }
  }

  getConfig(): BoardHealthWorkerConfig {
    return { ...this.config }
  }

  // ── Core tick ──────────────────────────────────────────────────────────

  async tick(options?: { dryRun?: boolean; force?: boolean }): Promise<{
    actions: PolicyAction[]
    digest: BoardHealthDigest | null
    skipped: boolean
    reason?: string
  }> {
    const now = Date.now()
    const dryRun = options?.dryRun ?? this.config.dryRun
    const force = options?.force ?? false

    // Quiet hours check
    if (!force && this.isQuietHours(now)) {
      return { actions: [], digest: null, skipped: true, reason: 'quiet-hours' }
    }

    this.tickCount++
    this.lastTickAt = now
    const actions: PolicyAction[] = []

    // 1. Detect stale doing tasks
    const staleDoing = this.findStaleDoingTasks(now)
    let actionCount = 0

    for (const task of staleDoing) {
      if (actionCount >= this.config.maxActionsPerTick) break

      // Don't re-block already blocked tasks or TEST: tasks
      if (task.title?.startsWith('TEST:')) continue

      const action = await this.applyAutoBlockStale(task, now, dryRun)
      if (action) {
        actions.push(action)
        actionCount++
      }
    }

    // 2. Detect tasks that should be suggested for close
    const abandonedTasks = this.findAbandonedTasks(now)
    for (const task of abandonedTasks) {
      if (actionCount >= this.config.maxActionsPerTick) break
      if (task.title?.startsWith('TEST:')) continue

      const action = await this.applySuggestClose(task, now, dryRun)
      if (action) {
        actions.push(action)
        actionCount++
      }
    }

    // 3. Ready-queue floor check
    const rqfActions = await this.checkReadyQueueFloor(now, dryRun)
    actions.push(...rqfActions)

    // 3b. Reflection automation nudges
    if (!dryRun) {
      try {
        const { tickReflectionNudges } = await import('./reflection-automation.js')
        await tickReflectionNudges()
      } catch { /* reflection automation may not be loaded */ }
    }

    // 3c. Working contract enforcement (auto-requeue stale doing tasks)
    if (!dryRun) {
      try {
        const { tickWorkingContract } = await import('./working-contract.js')
        const wcResult = await tickWorkingContract()
        if (wcResult.requeued > 0 || wcResult.warnings > 0) {
          for (const action of wcResult.actions) {
            actions.push({
              id: `wc-${action.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
              kind: (action.type === 'auto_requeue' ? 'auto-requeue' : 'working-contract-warning') as PolicyActionKind,
              taskId: action.taskId,
              agent: action.agent,
              description: action.reason,
              previousState: { type: action.type },
              appliedAt: action.timestamp,
              rolledBack: false,
              rolledBackAt: null,
              rollbackBy: null,
            })
          }
        }
      } catch { /* working-contract module may not be loaded */ }
    }

    // 3d. Continuity loop: auto-replenish queues from promoted insights
    if (!dryRun) {
      try {
        const { tickContinuityLoop } = await import('./continuity-loop.js')
        const clResult = await tickContinuityLoop()
        if (clResult.replenished > 0) {
          actions.push(...clResult.actions.map(a => ({
            id: a.id,
            kind: 'continuity-replenish' as PolicyActionKind,
            taskId: a.taskId ?? null,
            agent: a.agent,
            description: a.detail,
            previousState: { insightId: a.insightId },
            appliedAt: a.timestamp,
            rolledBack: false,
            rolledBackAt: null,
            rollbackBy: null,
          })))
        }
      } catch { /* continuity loop may not be loaded */ }
    }

    // 4. Emit digest if interval elapsed
    let digest: BoardHealthDigest | null = null
    if (force || now - this.lastDigestAt >= this.config.digestIntervalMs) {
      digest = await this.emitDigest(now, actions, dryRun)
      if (!dryRun) {
        this.lastDigestAt = now
      }
    }

    return { actions, digest, skipped: false }
  }

  // ── Policy: Auto-block stale doing ────────────────────────────────────

  private findStaleDoingTasks(now: number): Task[] {
    const thresholdMs = this.config.staleDoingThresholdMin * 60_000
    const doingTasks = taskManager.listTasks({ status: 'doing' })

    return doingTasks.filter(task => {
      // Verify task still exists (guards against stale cache entries)
      if (!verifyTaskExists(task.id)) return false
      const lastActivity = this.getTaskLastActivityAt(task)
      if (!lastActivity) return false
      // Validate timestamp is within reasonable bounds
      const validatedTs = validateTaskTimestamp(lastActivity, now)
      if (!validatedTs) return false
      return now - validatedTs > thresholdMs
    })
  }

  private async applyAutoBlockStale(
    task: Task,
    now: number,
    dryRun: boolean,
  ): Promise<PolicyAction | null> {
    // Check if we already acted on this task recently
    const recentAction = this.auditLog.find(
      a => a.taskId === task.id && a.kind === 'auto-block-stale' && !a.rolledBack
        && now - a.appliedAt < this.config.rollbackWindowMs,
    )
    if (recentAction) return null

    const staleMinutes = Math.floor(
      (now - this.getTaskLastActivityAt(task)) / 60_000,
    )

    const action: PolicyAction = {
      id: `bh-${now}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'auto-block-stale',
      taskId: task.id,
      agent: task.assignee || null,
      description: `Auto-blocked stale doing task (${staleMinutes}m inactive, threshold: ${this.config.staleDoingThresholdMin}m)`,
      previousState: {
        status: task.status,
        metadata: task.metadata ? { ...task.metadata as Record<string, unknown> } : null,
      },
      appliedAt: now,
      rolledBack: false,
      rolledBackAt: null,
      rollbackBy: null,
    }

    if (!dryRun) {
      try {
        await taskManager.updateTask(task.id, {
          status: 'blocked' as Task['status'],
          metadata: {
            ...(task.metadata as Record<string, unknown> || {}),
            board_health_action: 'auto-blocked-stale',
            board_health_action_at: now,
            board_health_action_id: action.id,
            board_health_stale_minutes: staleMinutes,
          },
        })

        // Notify the assignee
        if (task.assignee) {
          await routeMessage({
            from: 'system',
            content: `⚠️ Board health: auto-blocked **${task.id}** (${task.title}) — ${staleMinutes}m with no activity. @${task.assignee} update status or rollback via \`POST /board-health/rollback/${action.id}\`.`,
            category: 'watchdog-alert',
            severity: 'warning',
            taskId: task.id,
            mentions: [task.assignee],
          })
        }
      } catch {
        return null
      }
    }

    this.auditLog.push(action)
    return action
  }

  // ── Policy: Suggest close ─────────────────────────────────────────────

  private findAbandonedTasks(now: number): Task[] {
    const thresholdMs = this.config.suggestCloseThresholdMin * 60_000
    const candidates = taskManager.listTasks({}).filter(
      t => t.status === 'blocked' || t.status === 'todo',
    )

    return candidates.filter(task => {
      // Verify task still exists (guards against stale cache)
      if (!verifyTaskExists(task.id)) return false
      const lastActivity = this.getTaskLastActivityAt(task)
      if (!lastActivity) {
        // If no activity at all, check createdAt with validation
        const createdAt = validateTaskTimestamp(task.createdAt, now)
        return createdAt !== null && now - createdAt > thresholdMs
      }
      const validatedTs = validateTaskTimestamp(lastActivity, now)
      if (!validatedTs) return false
      return now - validatedTs > thresholdMs
    })
  }

  private async applySuggestClose(
    task: Task,
    now: number,
    dryRun: boolean,
  ): Promise<PolicyAction | null> {
    // Check if we already suggested close for this task
    const recentAction = this.auditLog.find(
      a => a.taskId === task.id && a.kind === 'suggest-close' && !a.rolledBack
        && now - a.appliedAt < 24 * 60 * 60 * 1000, // Don't re-suggest within 24h
    )
    if (recentAction) return null

    const lastActivity = this.getTaskLastActivityAt(task)
    const staleMinutes = lastActivity
      ? Math.floor((now - lastActivity) / 60_000)
      : Math.floor((now - (typeof task.createdAt === 'number' ? task.createdAt : now)) / 60_000)

    const action: PolicyAction = {
      id: `bh-${now}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'suggest-close',
      taskId: task.id,
      agent: task.assignee || null,
      description: `Suggested close for abandoned task (${staleMinutes}m inactive, status: ${task.status})`,
      previousState: null, // No state change — just a suggestion
      appliedAt: now,
      rolledBack: false,
      rolledBackAt: null,
      rollbackBy: null,
    }

    if (!dryRun) {
      try {
        // Add a comment to the task
        const comments = taskManager.getTaskComments(task.id)
        const hasRecentBotComment = comments.some(
          c => c.author === 'system' && now - (typeof c.timestamp === 'number' ? c.timestamp : 0) < 24 * 60 * 60 * 1000,
        )
        if (!hasRecentBotComment) {
          await taskManager.addTaskComment(
            task.id,
            'system',
            `🔍 Board health: this task has been inactive for ${Math.floor(staleMinutes / 60)}h${staleMinutes % 60}m. Consider closing if no longer needed. Action ID: ${action.id}`,
          )
        }
      } catch {
        return null
      }
    }

    this.auditLog.push(action)
    return action
  }

  // ── Policy: Ready-queue floor ──────────────────────────────────────────

  /** Track last alert time per agent to enforce cooldown */
  private readyQueueLastAlertAt: Record<string, number> = {}
  /** Track when each agent's queue first went empty (for idle escalation) */
  private idleQueueSince: Record<string, number> = {}

  private async checkReadyQueueFloor(now: number, dryRun: boolean): Promise<PolicyAction[]> {
    const policy = policyManager.get()
    const rqf = policy.readyQueueFloor
    if (!rqf?.enabled) return []

    const actions: PolicyAction[] = []

    for (const agent of rqf.agents) {
      // Count unblocked todo tasks for this agent
      const todoTasks = taskManager.listTasks({ status: 'todo', assignee: agent })
      const unblockedTodo = todoTasks.filter(t => {
        const blocked = t.metadata?.blocked_by
        if (!blocked) return true
        // Check if blocker is still open
        const blocker = taskManager.getTask(blocked as string)
        return !blocker || blocker.status === 'done'
      })

      const doingTasks = taskManager.listTasks({ status: 'doing', assignee: agent })
      const readyCount = unblockedTodo.length

      // Check cooldown
      const lastAlert = this.readyQueueLastAlertAt[agent] || 0
      const cooldownMs = (rqf.cooldownMin || 30) * 60_000

      // Ready-queue floor warning
      if (readyCount < rqf.minReady && now - lastAlert > cooldownMs) {
        const deficit = rqf.minReady - readyCount
        const msg = `⚠️ Ready-queue floor: @${agent} has ${readyCount}/${rqf.minReady} unblocked todo tasks (need ${deficit} more). @sage @pixel — please spec/assign tasks to keep engineering lane fed.`

        if (!dryRun) {
          try {
            await routeMessage({
              from: 'system',
              content: msg,
              category: 'watchdog-alert',
              severity: 'warning',
              forceChannel: rqf.channel || 'general',
            })
          } catch { /* chat may not be available in test */ }
          this.readyQueueLastAlertAt[agent] = now
        }

        const action: PolicyAction = {
          id: `rqf-${agent}-${now}`,
          kind: 'ready-queue-warning',
          taskId: null,
          agent,
          description: `Ready queue below floor: ${readyCount}/${rqf.minReady} for @${agent}`,
          previousState: { readyCount, doingCount: doingTasks.length },
          appliedAt: now,
          rolledBack: false,
          rolledBackAt: null,
          rollbackBy: null,
        }
        this.auditLog.push(action)
        actions.push(action)
      }

      // Idle escalation: agent has 0 doing + 0 todo for too long
      const totalActive = doingTasks.length + readyCount
      if (totalActive === 0) {
        if (!this.idleQueueSince[agent]) {
          this.idleQueueSince[agent] = now
        }
        const idleMinutes = Math.floor((now - this.idleQueueSince[agent]) / 60_000)

        if (idleMinutes >= (rqf.escalateAfterMin || 60) && now - lastAlert > cooldownMs) {
          const msg = `🚨 Idle escalation: @${agent} has had 0 tasks (doing + todo) for ${idleMinutes}m. Immediate assignment needed. @sage`

          if (!dryRun) {
            try {
              await routeMessage({ from: 'system', content: msg, forceChannel: rqf.channel || 'general', category: 'escalation', severity: 'critical' })
            } catch { /* chat may not be available in test */ }
            this.readyQueueLastAlertAt[agent] = now
          }

          const action: PolicyAction = {
            id: `idle-${agent}-${now}`,
            kind: 'idle-queue-escalation',
            taskId: null,
            agent,
            description: `Idle queue escalation: @${agent} idle for ${idleMinutes}m`,
            previousState: { idleMinutes },
            appliedAt: now,
            rolledBack: false,
            rolledBackAt: null,
            rollbackBy: null,
          }
          this.auditLog.push(action)
          actions.push(action)
        }
      } else {
        // Reset idle tracker when agent has work
        delete this.idleQueueSince[agent]
      }
    }

    return actions
  }

  // ── Digest ────────────────────────────────────────────────────────────

  private async emitDigest(
    now: number,
    recentActions: PolicyAction[],
    dryRun: boolean,
  ): Promise<BoardHealthDigest> {
    const allTasks = taskManager.listTasks({})
    const doingTasks = allTasks.filter(t => t.status === 'doing')
    const blockedTasks = allTasks.filter(t => t.status === 'blocked')
    const todoTasks = allTasks.filter(t => t.status === 'todo')
    const validatingTasks = allTasks.filter(t => t.status === 'validating')

    const staleDoingCount = this.findStaleDoingTasks(now).length
    const suggestedCloseCount = this.findAbandonedTasks(now).length

    const blockedTaskIds = recentActions
      .filter(a => a.kind === 'auto-block-stale' && a.taskId)
      .map(a => a.taskId!)
    const suggestedCloseTaskIds = recentActions
      .filter(a => a.kind === 'suggest-close' && a.taskId)
      .map(a => a.taskId!)

    const lines = [
      `📊 **Board Health Digest**`,
      ``,
      `**Board:** ${todoTasks.length} todo · ${doingTasks.length} doing · ${validatingTasks.length} validating · ${blockedTasks.length} blocked`,
      `**Stale doing:** ${staleDoingCount} tasks (>${this.config.staleDoingThresholdMin}m threshold)`,
      `**Abandoned candidates:** ${suggestedCloseCount} tasks (>${Math.floor(this.config.suggestCloseThresholdMin / 60)}h threshold)`,
    ]

    if (recentActions.length > 0) {
      lines.push(``, `**Actions this cycle:** ${recentActions.length}`)
      for (const a of recentActions.slice(0, 5)) {
        lines.push(`- ${a.kind}: ${a.taskId || 'n/a'} — ${a.description}`)
      }
      if (recentActions.length > 5) {
        lines.push(`- ... and ${recentActions.length - 5} more`)
      }
    } else {
      lines.push(``, `**Actions this cycle:** none (board is healthy ✅)`)
    }

    const summary = lines.join('\n')

    const digest: BoardHealthDigest = {
      timestamp: now,
      staleDoingCount,
      suggestedCloseCount,
      actionsApplied: recentActions.length,
      blockedTasks: blockedTaskIds,
      suggestedCloseTasks: suggestedCloseTaskIds,
      summary,
    }

    if (!dryRun) {
      await routeMessage({
        from: 'system',
        content: summary,
        category: 'digest',
        severity: 'info',
      }).catch(() => {})

      // Log digest as audit action
      this.auditLog.push({
        id: `bh-digest-${now}`,
        kind: 'digest-emitted',
        taskId: null,
        agent: null,
        description: `Digest emitted: ${recentActions.length} actions, ${staleDoingCount} stale, ${suggestedCloseCount} abandoned`,
        previousState: null,
        appliedAt: now,
        rolledBack: false,
        rolledBackAt: null,
        rollbackBy: null,
      })
    }

    return digest
  }

  // ── Rollback ──────────────────────────────────────────────────────────

  async rollback(actionId: string, rolledBackBy: string = 'manual'): Promise<{
    success: boolean
    message: string
    action?: PolicyAction
  }> {
    const action = this.auditLog.find(a => a.id === actionId)
    if (!action) {
      return { success: false, message: `Action ${actionId} not found` }
    }

    if (action.rolledBack) {
      return { success: false, message: `Action ${actionId} already rolled back at ${new Date(action.rolledBackAt!).toISOString()}` }
    }

    const now = Date.now()
    if (now - action.appliedAt > this.config.rollbackWindowMs) {
      return {
        success: false,
        message: `Rollback window expired (${Math.floor(this.config.rollbackWindowMs / 60_000)}m). Action was applied ${Math.floor((now - action.appliedAt) / 60_000)}m ago.`,
      }
    }

    // Only auto-block-stale is rollbackable (it changes task state)
    if (action.kind === 'auto-block-stale' && action.taskId && action.previousState) {
      try {
        const prev = action.previousState as { status?: string; metadata?: Record<string, unknown> }
        await taskManager.updateTask(action.taskId, {
          status: (prev.status || 'doing') as Task['status'],
          metadata: {
            ...(prev.metadata || {}),
            board_health_rollback: true,
            board_health_rollback_at: now,
            board_health_rollback_by: rolledBackBy,
          },
        })

        action.rolledBack = true
        action.rolledBackAt = now
        action.rollbackBy = rolledBackBy

        await routeMessage({
          from: 'system',
          content: `↩️ Board health rollback: **${action.taskId}** restored to \`${prev.status}\` (action ${actionId} reversed by ${rolledBackBy}).`,
          category: 'system-info',
          severity: 'info',
          taskId: action.taskId || undefined,
        }).catch(() => {})

        return { success: true, message: `Rolled back action ${actionId}`, action }
      } catch (err: any) {
        return { success: false, message: `Rollback failed: ${err.message || 'unknown error'}` }
      }
    }

    if (action.kind === 'suggest-close') {
      // Suggest-close doesn't change state, just mark as rolled back to suppress re-suggestion
      action.rolledBack = true
      action.rolledBackAt = now
      action.rollbackBy = rolledBackBy
      return { success: true, message: `Close suggestion dismissed for ${action.taskId}`, action }
    }

    return { success: false, message: `Action kind '${action.kind}' is not rollbackable` }
  }

  // ── Query ─────────────────────────────────────────────────────────────

  getStatus(): {
    config: BoardHealthWorkerConfig
    running: boolean
    lastTickAt: number
    lastDigestAt: number
    tickCount: number
    auditLogSize: number
    recentActions: PolicyAction[]
    rollbackableActions: PolicyAction[]
  } {
    const now = Date.now()
    const recent = this.auditLog.filter(a => now - a.appliedAt < 24 * 60 * 60 * 1000)
    const rollbackable = this.auditLog.filter(
      a => !a.rolledBack && a.previousState !== null && now - a.appliedAt < this.config.rollbackWindowMs,
    )

    return {
      config: { ...this.config },
      running: this.timer !== null,
      lastTickAt: this.lastTickAt,
      lastDigestAt: this.lastDigestAt,
      tickCount: this.tickCount,
      auditLogSize: this.auditLog.length,
      recentActions: recent,
      rollbackableActions: rollbackable,
    }
  }

  getAuditLog(options?: { limit?: number; since?: number; kind?: PolicyActionKind }): PolicyAction[] {
    let log = this.auditLog

    if (options?.since) {
      log = log.filter(a => a.appliedAt >= options.since!)
    }
    if (options?.kind) {
      log = log.filter(a => a.kind === options.kind)
    }

    // Most recent first
    log = log.slice().sort((a, b) => b.appliedAt - a.appliedAt)

    if (options?.limit) {
      log = log.slice(0, options.limit)
    }

    return log
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private getTaskLastActivityAt(task: Task): number {
    try {
      const { getEffectiveActivity } = require('./activity-signal.js') as typeof import('./activity-signal.js')
      const signal = getEffectiveActivity(task.id, task.assignee, task.createdAt)
      return signal.effectiveActivityTs
    } catch {
      // Fallback if activity-signal not available
      const updatedAt = typeof task.updatedAt === 'number' ? task.updatedAt : 0
      const comments = taskManager.getTaskComments(task.id)
      const latestCommentAt = comments.reduce((max, c) => {
        const ts = typeof c.timestamp === 'number' ? c.timestamp : 0
        return Math.max(max, ts)
      }, 0)
      return Math.max(updatedAt, latestCommentAt)
    }
  }

  private isQuietHours(now: number): boolean {
    const hour = new Date(now).getHours()
    if (this.config.quietHoursStart <= this.config.quietHoursEnd) {
      return hour >= this.config.quietHoursStart && hour < this.config.quietHoursEnd
    }
    // Wraps midnight (e.g., 22-6)
    return hour >= this.config.quietHoursStart || hour < this.config.quietHoursEnd
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  /** Prune audit log entries older than 7 days */
  pruneAuditLog(maxAgeDays: number = 7): number {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    const before = this.auditLog.length
    this.auditLog = this.auditLog.filter(a => a.appliedAt >= cutoff)
    return before - this.auditLog.length
  }
}

// ── Singleton ────────────────────────────────────────────────────────────

export const boardHealthWorker = new BoardHealthWorker({
  enabled: process.env.BOARD_HEALTH_ENABLED !== 'false',
  intervalMs: Number(process.env.BOARD_HEALTH_INTERVAL_MS || 5 * 60 * 1000),
  staleDoingThresholdMin: Number(process.env.BOARD_HEALTH_STALE_DOING_MIN || 240),
  suggestCloseThresholdMin: Number(process.env.BOARD_HEALTH_SUGGEST_CLOSE_MIN || 1440),
  rollbackWindowMs: Number(process.env.BOARD_HEALTH_ROLLBACK_WINDOW_MS || 60 * 60 * 1000),
  digestIntervalMs: Number(process.env.BOARD_HEALTH_DIGEST_INTERVAL_MS || 4 * 60 * 60 * 1000),
  digestChannel: process.env.BOARD_HEALTH_DIGEST_CHANNEL || 'ops',
  quietHoursStart: Number(process.env.BOARD_HEALTH_QUIET_START || 0),
  quietHoursEnd: Number(process.env.BOARD_HEALTH_QUIET_END || 6),
  dryRun: process.env.BOARD_HEALTH_DRY_RUN === 'true',
  maxActionsPerTick: Number(process.env.BOARD_HEALTH_MAX_ACTIONS || 5),
})
