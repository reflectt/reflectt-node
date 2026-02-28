// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Alert-integrity preflight guard
 *
 * Reconciles live task/agent state before publishing alerts.
 * Eliminates false-positive SLA/requeue/stale alerts by verifying
 * the condition still holds at publish time.
 *
 * Modes (ALERT_PREFLIGHT_MODE env var):
 *   - canary:  log what would be suppressed, still send (default)
 *   - enforce: actually suppress false positives
 *   - off:     bypass entirely
 */

import { createHash } from 'crypto'
import { appendFileSync } from 'fs'
import { join } from 'path'
import { DATA_DIR } from './config.js'
import { taskManager } from './tasks.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface PreflightInput {
  taskId: string
  alertType: string
  /** Agent the alert concerns (assignee/reviewer) */
  agentId?: string
  /** Expected task status when alert was triggered */
  expectedStatus?: string
  /** Expected assignee when alert was triggered */
  expectedAssignee?: string
  /** Expected reviewer when alert was triggered */
  expectedReviewer?: string
  /** Alert message content (for audit trail) */
  content?: string
  /** Channel the alert would be posted to */
  channel?: string
}

export interface PreflightResult {
  proceed: boolean
  reason?: string
  latencyMs: number
  idempotentKey: string
  mode: PreflightMode
}

export type PreflightMode = 'canary' | 'enforce' | 'off'

interface PreflightMetrics {
  totalChecked: number
  suppressed: number
  canaryFlagged: number
  latencies: number[]
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Recent activity window — if a comment/update was within this window, suppress stale alerts */
const RECENT_ACTIVITY_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

/** Idempotent key dedup window */
const DEDUP_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

/** Max latency samples to keep for p95 calculation */
const MAX_LATENCY_SAMPLES = 1000

const AUDIT_FILE = join(DATA_DIR, 'alert-preflight-audit.jsonl')

// ── State ──────────────────────────────────────────────────────────────────

const metrics: PreflightMetrics = {
  totalChecked: 0,
  suppressed: 0,
  canaryFlagged: 0,
  latencies: [],
}

/** Map of idempotentKey → timestamp for dedup */
const recentKeys = new Map<string, number>()

// ── Mode ───────────────────────────────────────────────────────────────────

export function getPreflightMode(): PreflightMode {
  const mode = (process.env.ALERT_PREFLIGHT_MODE || 'canary').toLowerCase()
  if (mode === 'enforce' || mode === 'off' || mode === 'canary') return mode
  return 'canary'
}

// ── Core ───────────────────────────────────────────────────────────────────

/**
 * Run preflight check before publishing an alert.
 * Returns whether the alert should proceed.
 */
export function preflightCheck(input: PreflightInput): PreflightResult {
  const start = performance.now()
  const mode = getPreflightMode()

  // Off mode — bypass entirely
  if (mode === 'off') {
    return {
      proceed: true,
      reason: 'preflight disabled',
      latencyMs: performance.now() - start,
      idempotentKey: '',
      mode,
    }
  }

  metrics.totalChecked++

  // 1. Compute state hash for idempotent key
  const stateHash = computeStateHash(input)
  const idempotentKey = `${input.taskId}:${input.alertType}:${stateHash}`

  // 2. Check idempotent key dedup
  const now = Date.now()
  pruneExpiredKeys(now)
  if (recentKeys.has(idempotentKey)) {
    const result = buildResult(false, 'duplicate alert (idempotent key exists)', start, idempotentKey, mode)
    recordSuppression(input, result, 'dedup')
    return result
  }

  // 3. Reconcile live task state
  const reconciliation = reconcileLiveState(input, now)
  if (!reconciliation.valid) {
    const result = buildResult(false, reconciliation.reason, start, idempotentKey, mode)
    recordSuppression(input, result, 'stale_state')
    return result
  }

  // 4. Alert passes preflight — record the key
  recentKeys.set(idempotentKey, now)

  const latencyMs = performance.now() - start
  recordLatency(latencyMs)

  return {
    proceed: true,
    latencyMs,
    idempotentKey,
    mode,
  }
}

// ── Reconciliation ─────────────────────────────────────────────────────────

interface ReconcileResult {
  valid: boolean
  reason?: string
}

function reconcileLiveState(input: PreflightInput, now: number): ReconcileResult {
  const task = input.taskId ? taskManager.getTask(input.taskId) : undefined

  // If task doesn't exist, let the alert through (might be a system alert)
  if (!input.taskId || !task) {
    return { valid: true }
  }

  // Check 1: Status drift — task status changed since alert was triggered
  if (input.expectedStatus && task.status !== input.expectedStatus) {
    return {
      valid: false,
      reason: `status drift: expected=${input.expectedStatus}, actual=${task.status}`,
    }
  }

  // Check 2: Assignee drift
  if (input.expectedAssignee && task.assignee !== input.expectedAssignee) {
    return {
      valid: false,
      reason: `assignee drift: expected=${input.expectedAssignee}, actual=${task.assignee}`,
    }
  }

  // Check 3: Reviewer drift
  if (input.expectedReviewer && task.reviewer !== input.expectedReviewer) {
    return {
      valid: false,
      reason: `reviewer drift: expected=${input.expectedReviewer}, actual=${task.reviewer}`,
    }
  }

  // Check 4: Recent activity — if there's been a comment in the last 5 minutes,
  // suppress stale/idle alerts (the agent is actively working)
  if (input.alertType === 'stale' || input.alertType === 'idle' || input.alertType === 'sla_warning') {
    const comments = taskManager.getTaskComments(input.taskId)
    if (comments.length > 0) {
      const lastComment = comments[comments.length - 1]!
      const commentAge = now - (lastComment.timestamp || 0)
      if (commentAge < RECENT_ACTIVITY_WINDOW_MS) {
        return {
          valid: false,
          reason: `recent activity: comment ${Math.round(commentAge / 1000)}s ago (window: ${RECENT_ACTIVITY_WINDOW_MS / 1000}s)`,
        }
      }
    }

    // Also check task updatedAt
    if (task.updatedAt && (now - task.updatedAt) < RECENT_ACTIVITY_WINDOW_MS) {
      return {
        valid: false,
        reason: `recent update: task updated ${Math.round((now - task.updatedAt) / 1000)}s ago`,
      }
    }
  }

  // Check 5: Task already done — suppress alerts for completed tasks
  if (task.status === 'done') {
    return {
      valid: false,
      reason: `task already done`,
    }
  }

  return { valid: true }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function computeStateHash(input: PreflightInput): string {
  const task = input.taskId ? taskManager.getTask(input.taskId) : undefined
  const hashInput = [
    input.taskId,
    input.alertType,
    task?.status || 'unknown',
    task?.assignee || '',
    task?.reviewer || '',
    task?.updatedAt?.toString() || '',
  ].join(':')

  return createHash('sha256').update(hashInput).digest('hex').slice(0, 12)
}

function buildResult(
  proceed: boolean,
  reason: string | undefined,
  startTime: number,
  idempotentKey: string,
  mode: PreflightMode,
): PreflightResult {
  const latencyMs = performance.now() - startTime
  recordLatency(latencyMs)

  // In canary mode, flag but still proceed
  const actualProceed = mode === 'canary' ? true : proceed
  if (!proceed && mode === 'canary') {
    metrics.canaryFlagged++
  }
  if (!proceed && mode === 'enforce') {
    metrics.suppressed++
  }

  return {
    proceed: actualProceed,
    reason: !proceed ? `[${mode}] ${reason}` : reason,
    latencyMs,
    idempotentKey,
    mode,
  }
}

function recordLatency(ms: number): void {
  metrics.latencies.push(ms)
  if (metrics.latencies.length > MAX_LATENCY_SAMPLES) {
    metrics.latencies.shift()
  }
}

function recordSuppression(input: PreflightInput, result: PreflightResult, category: string): void {
  const entry = {
    ts: Date.now(),
    taskId: input.taskId,
    alertType: input.alertType,
    agentId: input.agentId,
    mode: result.mode,
    category,
    reason: result.reason,
    idempotentKey: result.idempotentKey,
    proceed: result.proceed,
  }

  try {
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n')
  } catch {
    // Audit file write failure is non-fatal
  }
}

function pruneExpiredKeys(now: number): void {
  for (const [key, ts] of recentKeys) {
    if (now - ts > DEDUP_WINDOW_MS) {
      recentKeys.delete(key)
    }
  }
}

// ── Metrics ────────────────────────────────────────────────────────────────

export function getPreflightMetrics(): {
  totalChecked: number
  suppressed: number
  canaryFlagged: number
  latencyP95: number
  mode: PreflightMode
} {
  const sorted = [...metrics.latencies].sort((a, b) => a - b)
  const p95Index = Math.floor(sorted.length * 0.95)
  const latencyP95 = sorted.length > 0 ? sorted[p95Index] ?? 0 : 0

  return {
    totalChecked: metrics.totalChecked,
    suppressed: metrics.suppressed,
    canaryFlagged: metrics.canaryFlagged,
    latencyP95: Math.round(latencyP95 * 100) / 100,
    mode: getPreflightMode(),
  }
}

/** Reset metrics (for testing) */
export function resetPreflightMetrics(): void {
  metrics.totalChecked = 0
  metrics.suppressed = 0
  metrics.canaryFlagged = 0
  metrics.latencies = []
  recentKeys.clear()
}
