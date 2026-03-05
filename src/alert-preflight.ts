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

// ── Persistent daily snapshots ─────────────────────────────────────────────

const DAILY_FILE = join(DATA_DIR, 'alert-preflight-daily.jsonl')
let lastSnapshotDate = ''
let snapshotTimer: ReturnType<typeof setInterval> | null = null

/**
 * Initialize snapshot state from existing daily file and backfill
 * missing days from the audit log.  Called once on module load.
 */
function initSnapshotState(): void {
  try {
    const { readFileSync, existsSync } = require('fs')

    // Recover lastSnapshotDate so restarts don't duplicate today's entry
    if (existsSync(DAILY_FILE)) {
      const lines = readFileSync(DAILY_FILE, 'utf8').trim().split('\n').filter(Boolean)
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]!)
        if (last.date) lastSnapshotDate = last.date
      }
    }

    // Backfill missing days from audit log
    backfillFromAuditLog()
  } catch {
    // Non-fatal — best-effort initialization
  }
}

/**
 * Scan the audit log and generate daily snapshots for any dates
 * that don't already have an entry in the daily file.
 */
function backfillFromAuditLog(): void {
  try {
    const { readFileSync, existsSync } = require('fs')

    if (!existsSync(AUDIT_FILE)) return

    const auditContent = readFileSync(AUDIT_FILE, 'utf8').trim()
    if (!auditContent) return

    // Collect existing snapshot dates
    const existingDates = new Set<string>()
    if (existsSync(DAILY_FILE)) {
      const dailyContent = readFileSync(DAILY_FILE, 'utf8').trim()
      if (dailyContent) {
        for (const line of dailyContent.split('\n')) {
          try {
            const entry = JSON.parse(line)
            if (entry.date) existingDates.add(entry.date)
          } catch { /* skip malformed */ }
        }
      }
    }

    // Aggregate audit entries by date
    const byDate = new Map<string, { total: number; flagged: number; suppressed: number }>()
    for (const line of auditContent.split('\n')) {
      try {
        const entry = JSON.parse(line)
        const date = new Date(entry.ts).toISOString().slice(0, 10)
        if (existingDates.has(date)) continue // already have a snapshot

        let day = byDate.get(date)
        if (!day) { day = { total: 0, flagged: 0, suppressed: 0 }; byDate.set(date, day) }
        day.total++
        if (entry.mode === 'canary' && !entry.proceed) day.flagged++ // shouldn't happen, canary always proceeds
        if (entry.category) day.flagged++ // any categorized entry = would-be suppression
        if (entry.mode === 'enforce' && !entry.proceed) day.suppressed++
      } catch { /* skip malformed */ }
    }

    // Write backfilled snapshots (sorted by date)
    const dates = [...byDate.keys()].sort()
    for (const date of dates) {
      const day = byDate.get(date)!
      const snapshot = {
        date,
        ts: new Date(date + 'T23:59:59Z').getTime(),
        totalChecked: day.total,
        suppressed: day.suppressed,
        canaryFlagged: day.flagged,
        latencyP95: 0, // not available from audit log
        mode: 'canary',
        falsePositiveRate: day.total > 0
          ? Math.round((day.flagged / day.total) * 10000) / 100
          : 0,
        backfilled: true,
      }
      try {
        appendFileSync(DAILY_FILE, JSON.stringify(snapshot) + '\n')
        existingDates.add(date)
        lastSnapshotDate = date > lastSnapshotDate ? date : lastSnapshotDate
      } catch { /* non-fatal */ }
    }
  } catch {
    // Non-fatal — best-effort backfill
  }
}

/**
 * Append a daily metrics snapshot if the date has changed.
 * Called from getPreflightMetrics() and also from the health endpoint.
 * Idempotent per calendar day.
 */
export function snapshotDailyMetrics(): void {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  if (today === lastSnapshotDate) return
  if (metrics.totalChecked === 0) return // nothing to snapshot

  const sorted = [...metrics.latencies].sort((a, b) => a - b)
  const p95Index = Math.floor(sorted.length * 0.95)
  const latencyP95 = sorted.length > 0 ? sorted[p95Index] ?? 0 : 0

  const snapshot = {
    date: today,
    ts: Date.now(),
    totalChecked: metrics.totalChecked,
    suppressed: metrics.suppressed,
    canaryFlagged: metrics.canaryFlagged,
    latencyP95: Math.round(latencyP95 * 100) / 100,
    mode: getPreflightMode(),
    falsePositiveRate: metrics.totalChecked > 0
      ? Math.round((metrics.canaryFlagged / metrics.totalChecked) * 10000) / 100
      : 0,
  }

  try {
    appendFileSync(DAILY_FILE, JSON.stringify(snapshot) + '\n')
    lastSnapshotDate = today
  } catch {
    // Non-fatal — best-effort persistence
  }
}

/**
 * Start periodic auto-snapshot (hourly).
 * Ensures daily snapshots happen even if no health endpoint is accessed.
 */
export function startAutoSnapshot(): void {
  if (snapshotTimer) return
  snapshotTimer = setInterval(() => {
    snapshotDailyMetrics()
  }, 60 * 60 * 1000) // 1 hour
  snapshotTimer.unref() // Don't prevent process exit
}

/**
 * Stop the auto-snapshot timer (for testing/cleanup).
 */
export function stopAutoSnapshot(): void {
  if (snapshotTimer) {
    clearInterval(snapshotTimer)
    snapshotTimer = null
  }
}

/**
 * Read all daily snapshots for the observation window report.
 */
export function getDailySnapshots(): Array<{
  date: string
  totalChecked: number
  suppressed: number
  canaryFlagged: number
  latencyP95: number
  mode: string
  falsePositiveRate: number
  backfilled?: boolean
}> {
  try {
    const { readFileSync } = require('fs')
    const content = readFileSync(DAILY_FILE, 'utf8').trim()
    if (!content) return []
    return content.split('\n').map((line: string) => JSON.parse(line))
  } catch {
    return []
  }
}

// Initialize on module load
initSnapshotState()
