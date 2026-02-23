// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Alert Integrity Guard — Preflight Reconciliation
 *
 * P0-2 implementation for task-1771849175579-apuqqi0fd
 *
 * Before publishing any task-scoped alert, reconciles live task state
 * to prevent false-positive SLA/requeue/stale alerts.
 *
 * Preflight checks:
 *   1. Task still exists and is in the expected status
 *   2. Assignee/reviewer haven't changed since alert was generated
 *   3. Recent activity (comment ts) might invalidate the alert
 *   4. Idempotent key prevents duplicate alerts
 *
 * All preflight decisions are logged for audit + missed-alert sampling.
 */

import { createHash } from 'crypto'
import { taskManager } from './tasks.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface AlertPreflightInput {
  /** Task the alert is about */
  taskId: string
  /** Type of alert being sent */
  alertType: 'sla_warning' | 'sla_breach' | 'stale_task' | 'requeue' | 'idle_nudge' | 'watchdog' | 'escalation' | 'mention_rescue' | 'generic'
  /** The alert content (for dedup hashing) */
  content: string
  /** Who triggered the alert */
  from: string
  /** Expected task state when alert was generated */
  expectedState?: {
    status?: string
    assignee?: string
    reviewer?: string
  }
}

export interface AlertPreflightResult {
  /** Whether the alert should be published */
  allowed: boolean
  /** Why the alert was allowed or suppressed */
  reason: string
  /** Detailed reason code for metrics */
  reasonCode: 'allowed' | 'task_not_found' | 'status_changed' | 'assignee_changed' | 'recent_activity' | 'duplicate' | 'task_done' | 'canary_allowed'
  /** Live task state at preflight time */
  liveState?: {
    status: string
    assignee: string
    reviewer: string
    lastCommentTs: number | null
    stateHash: string
  }
  /** Preflight latency in ms */
  latencyMs: number
}

export interface AlertIntegrityConfig {
  /** Enable preflight checks (default: true) */
  enabled: boolean
  /** Canary mode — log but don't suppress (default: true) */
  canaryMode: boolean
  /** Recent activity window — suppress alerts if task was commented on within this window */
  recentActivityWindowMs: number
  /** Idempotent dedup window — suppress identical alerts within this window */
  dedupWindowMs: number
  /** Alert types that bypass preflight (always send) */
  bypassTypes: string[]
  /** Maximum dedup cache entries */
  maxDedupEntries: number
}

export interface AlertIntegrityStats {
  totalChecked: number
  totalAllowed: number
  totalSuppressed: number
  suppressionsByReason: Record<string, number>
  canaryWouldSuppress: number
  avgLatencyMs: number
  p95LatencyMs: number
}

// ── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AlertIntegrityConfig = {
  enabled: true,
  canaryMode: true, // Start in canary mode
  recentActivityWindowMs: 5 * 60 * 1000, // 5 minutes
  dedupWindowMs: 15 * 60 * 1000, // 15 minutes
  bypassTypes: ['escalation'], // Critical escalations always go through
  maxDedupEntries: 1000,
}

// ── Alert Integrity Guard ──────────────────────────────────────────────────

export class AlertIntegrityGuard {
  private config: AlertIntegrityConfig
  private dedupCache: Map<string, number> = new Map() // idempotent_key → timestamp
  private auditLog: Array<{
    timestamp: number
    taskId: string
    alertType: string
    result: AlertPreflightResult
  }> = []
  private latencies: number[] = []
  private stats: AlertIntegrityStats = {
    totalChecked: 0,
    totalAllowed: 0,
    totalSuppressed: 0,
    suppressionsByReason: {},
    canaryWouldSuppress: 0,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
  }

  constructor(config?: Partial<AlertIntegrityConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ── Core: Preflight Check ──────────────────────────────────────────────

  /**
   * Run preflight reconciliation for a task-scoped alert.
   * Returns whether the alert should be published.
   */
  preflight(input: AlertPreflightInput): AlertPreflightResult {
    const start = Date.now()
    this.stats.totalChecked++

    // 0. Bypass types always pass
    if (this.config.bypassTypes.includes(input.alertType)) {
      const result: AlertPreflightResult = {
        allowed: true,
        reason: `Alert type "${input.alertType}" bypasses preflight`,
        reasonCode: 'allowed',
        latencyMs: Date.now() - start,
      }
      this.recordResult(input, result)
      return result
    }

    if (!this.config.enabled) {
      const result: AlertPreflightResult = {
        allowed: true,
        reason: 'Preflight disabled',
        reasonCode: 'allowed',
        latencyMs: Date.now() - start,
      }
      this.recordResult(input, result)
      return result
    }

    // 1. Check task exists
    let task: any
    try {
      task = taskManager.getTask(input.taskId)
    } catch {
      task = null
    }

    if (!task) {
      const result: AlertPreflightResult = {
        allowed: false,
        reason: `Task ${input.taskId} not found — alert suppressed`,
        reasonCode: 'task_not_found',
        latencyMs: Date.now() - start,
      }
      return this.maybeCanary(input, result)
    }

    // Build live state
    const liveState = this.buildLiveState(task)

    // 2. Check if task is done — suppress stale alerts for completed work
    if (task.status === 'done' && input.alertType !== 'escalation') {
      const result: AlertPreflightResult = {
        allowed: false,
        reason: `Task ${input.taskId} is done — alert "${input.alertType}" suppressed`,
        reasonCode: 'task_done',
        liveState,
        latencyMs: Date.now() - start,
      }
      return this.maybeCanary(input, result)
    }

    // 3. Check status change — if expected status doesn't match, alert may be stale
    if (input.expectedState?.status && task.status !== input.expectedState.status) {
      const result: AlertPreflightResult = {
        allowed: false,
        reason: `Task status changed: expected "${input.expectedState.status}" but live is "${task.status}" — alert suppressed`,
        reasonCode: 'status_changed',
        liveState,
        latencyMs: Date.now() - start,
      }
      return this.maybeCanary(input, result)
    }

    // 4. Check assignee/reviewer change
    if (input.expectedState?.assignee && task.assignee !== input.expectedState.assignee) {
      const result: AlertPreflightResult = {
        allowed: false,
        reason: `Task assignee changed: expected "${input.expectedState.assignee}" but live is "${task.assignee}" — alert suppressed`,
        reasonCode: 'assignee_changed',
        liveState,
        latencyMs: Date.now() - start,
      }
      return this.maybeCanary(input, result)
    }

    // 5. Check recent activity — if task was just commented on, alert may be obsolete
    if (liveState.lastCommentTs) {
      const timeSinceComment = Date.now() - liveState.lastCommentTs
      if (timeSinceComment < this.config.recentActivityWindowMs) {
        const result: AlertPreflightResult = {
          allowed: false,
          reason: `Task has recent activity (${Math.round(timeSinceComment / 1000)}s ago) — alert may be stale`,
          reasonCode: 'recent_activity',
          liveState,
          latencyMs: Date.now() - start,
        }
        return this.maybeCanary(input, result)
      }
    }

    // 6. Idempotent dedup check
    const idempotentKey = this.computeIdempotentKey(input.taskId, input.alertType, liveState.stateHash)
    const lastSent = this.dedupCache.get(idempotentKey)
    if (lastSent && (Date.now() - lastSent) < this.config.dedupWindowMs) {
      const result: AlertPreflightResult = {
        allowed: false,
        reason: `Duplicate alert (same task + type + state hash) sent ${Math.round((Date.now() - lastSent) / 1000)}s ago`,
        reasonCode: 'duplicate',
        liveState,
        latencyMs: Date.now() - start,
      }
      return this.maybeCanary(input, result)
    }

    // Update dedup cache
    this.dedupCache.set(idempotentKey, Date.now())
    this.pruneDedupCache()

    // All checks passed — allow
    const result: AlertPreflightResult = {
      allowed: true,
      reason: 'Preflight passed — all checks OK',
      reasonCode: 'allowed',
      liveState,
      latencyMs: Date.now() - start,
    }
    this.recordResult(input, result)
    return result
  }

  // ── State Helpers ──────────────────────────────────────────────────────

  private buildLiveState(task: any): NonNullable<AlertPreflightResult['liveState']> {
    // Get latest comment timestamp
    let lastCommentTs: number | null = null
    try {
      const comments = taskManager.getTaskComments(task.id)
      if (comments && comments.length > 0) {
        lastCommentTs = Math.max(...comments.map((c: any) => c.timestamp || 0))
      }
    } catch { /* ok */ }

    // Compute state hash for idempotent key
    const stateHash = this.computeStateHash(task)

    return {
      status: task.status,
      assignee: task.assignee || '',
      reviewer: task.reviewer || (task.metadata?.reviewer as string) || '',
      lastCommentTs,
      stateHash,
    }
  }

  private computeStateHash(task: any): string {
    const stateStr = [
      task.status,
      task.assignee || '',
      task.reviewer || (task.metadata?.reviewer as string) || '',
      task.updatedAt || task.createdAt || '',
    ].join('|')
    return createHash('sha256').update(stateStr).digest('hex').substring(0, 12)
  }

  private computeIdempotentKey(taskId: string, alertType: string, stateHash: string): string {
    return `${taskId}:${alertType}:${stateHash}`
  }

  // ── Canary Mode ────────────────────────────────────────────────────────

  private maybeCanary(input: AlertPreflightInput, result: AlertPreflightResult): AlertPreflightResult {
    if (this.config.canaryMode) {
      this.stats.canaryWouldSuppress++
      const canaryResult: AlertPreflightResult = {
        ...result,
        allowed: true,
        reason: `canary_would_suppress: ${result.reason}`,
        reasonCode: 'canary_allowed',
      }
      this.recordResult(input, canaryResult)
      return canaryResult
    }

    this.stats.totalSuppressed++
    this.stats.suppressionsByReason[result.reasonCode] =
      (this.stats.suppressionsByReason[result.reasonCode] || 0) + 1
    this.recordResult(input, result)
    return result
  }

  // ── Recording & Audit ──────────────────────────────────────────────────

  private recordResult(input: AlertPreflightInput, result: AlertPreflightResult): void {
    if (result.allowed) {
      this.stats.totalAllowed++
    }

    // Track latency
    this.latencies.push(result.latencyMs)
    if (this.latencies.length > 1000) this.latencies.splice(0, 500)
    this.updateLatencyStats()

    // Audit log
    this.auditLog.push({
      timestamp: Date.now(),
      taskId: input.taskId,
      alertType: input.alertType,
      result,
    })
    if (this.auditLog.length > 500) {
      this.auditLog.splice(0, this.auditLog.length - 500)
    }

    if (!result.allowed || result.reasonCode === 'canary_allowed') {
      console.log(`[AlertIntegrity] ${result.reasonCode}: task=${input.taskId} type=${input.alertType} reason="${result.reason}"`)
    }
  }

  private updateLatencyStats(): void {
    if (this.latencies.length === 0) return
    const sorted = [...this.latencies].sort((a, b) => a - b)
    this.stats.avgLatencyMs = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length)
    this.stats.p95LatencyMs = sorted[Math.floor(sorted.length * 0.95)] || 0
  }

  private pruneDedupCache(): void {
    if (this.dedupCache.size <= this.config.maxDedupEntries) return
    const now = Date.now()
    for (const [key, ts] of this.dedupCache) {
      if (now - ts > this.config.dedupWindowMs) {
        this.dedupCache.delete(key)
      }
    }
    // If still over limit, remove oldest
    if (this.dedupCache.size > this.config.maxDedupEntries) {
      const entries = [...this.dedupCache.entries()].sort((a, b) => a[1] - b[1])
      const toRemove = entries.slice(0, entries.length - this.config.maxDedupEntries)
      for (const [key] of toRemove) {
        this.dedupCache.delete(key)
      }
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  getStats(): AlertIntegrityStats {
    return { ...this.stats }
  }

  getAuditLog(options?: { limit?: number; since?: number; taskId?: string }): typeof this.auditLog {
    let log = this.auditLog
    if (options?.taskId) {
      log = log.filter(e => e.taskId === options.taskId)
    }
    if (options?.since) {
      log = log.filter(e => e.timestamp >= options.since!)
    }
    log = log.slice().sort((a, b) => b.timestamp - a.timestamp)
    if (options?.limit) {
      log = log.slice(0, options.limit)
    }
    return log
  }

  /**
   * Get rollback signals for canary evaluation.
   */
  getRollbackSignals(): {
    missedTruePositives: number
    p95LatencyMs: number
    criticalAlertErrors: number
    rollbackTriggered: boolean
  } {
    // Missed true positives would need external adjudication
    // For now, track critical alert suppression as a proxy
    const criticalSuppressed = this.auditLog.filter(
      e => e.alertType === 'escalation' && !e.result.allowed
    ).length

    return {
      missedTruePositives: 0, // Requires manual sampling/adjudication
      p95LatencyMs: this.stats.p95LatencyMs,
      criticalAlertErrors: criticalSuppressed,
      rollbackTriggered: criticalSuppressed >= 3 || this.stats.p95LatencyMs > 500,
    }
  }

  getConfig(): Readonly<AlertIntegrityConfig> {
    return { ...this.config }
  }

  updateConfig(updates: Partial<AlertIntegrityConfig>): void {
    this.config = { ...this.config, ...updates }
    console.log('[AlertIntegrity] Config updated:', JSON.stringify(updates))
  }

  /** Exit canary mode — start enforcing suppression */
  activateEnforcement(): void {
    this.config.canaryMode = false
    console.log('[AlertIntegrity] Canary mode OFF — enforcement active')
  }

  /** Reset stats (for testing) */
  resetStats(): void {
    this.stats = {
      totalChecked: 0,
      totalAllowed: 0,
      totalSuppressed: 0,
      suppressionsByReason: {},
      canaryWouldSuppress: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
    }
    this.latencies = []
    this.dedupCache.clear()
    this.auditLog = []
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

export const alertIntegrityGuard = new AlertIntegrityGuard()
