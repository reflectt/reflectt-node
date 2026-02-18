// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Mutation Alert — Detects and alerts on suspicious reviewer-state mutations.
 * 
 * Tracks:
 * 1. Non-reviewer actors attempting to set reviewer_approved
 * 2. Repeated flip attempts (toggling approval state)
 * 3. Rapid mutation bursts from same actor on same task
 * 
 * Alerts are throttled to avoid spam.
 */

import { chatManager } from './chat.js'
import { recordAudit } from './auditLedger.js'

// ── Configuration ──────────────────────────────────────────────────────────

/** Minimum interval between alerts for the same actor+task combo */
const ALERT_THROTTLE_MS = 5 * 60 * 1000 // 5 minutes

/** Number of attempts in window that triggers escalated alert */
const FLIP_THRESHOLD = 3

/** Window for counting flip attempts */
const FLIP_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

// ── State ──────────────────────────────────────────────────────────────────

interface AttemptRecord {
  actor: string
  taskId: string
  timestamps: number[]
  lastAlertAt: number
}

/** Track attempts per actor+task */
const attempts = new Map<string, AttemptRecord>()

/** Track all alerts for the status endpoint */
const alertLog: Array<{
  timestamp: number
  type: 'unauthorized_approval' | 'flip_attempt' | 'burst_alert'
  taskId: string
  actor: string
  expectedReviewer: string
  message: string
  throttled: boolean
}> = []
const ALERT_LOG_MAX = 200

// ── Core Alert Functions ───────────────────────────────────────────────────

/**
 * Record and potentially alert on a non-reviewer approval attempt.
 * Called when someone tries to set reviewer_approved but isn't the assigned reviewer.
 */
export async function alertUnauthorizedApproval(opts: {
  taskId: string
  taskTitle: string
  actor: string
  expectedReviewer: string
  context: string
}): Promise<void> {
  const now = Date.now()
  const key = `${opts.actor}:${opts.taskId}`

  // Record in audit ledger
  await recordAudit({
    timestamp: now,
    taskId: opts.taskId,
    actor: opts.actor,
    field: 'metadata.reviewer_approved',
    before: null,
    after: 'REJECTED — unauthorized',
    context: `${opts.context} (expected reviewer: ${opts.expectedReviewer})`,
  })

  // Track attempt
  let record = attempts.get(key)
  if (!record) {
    record = { actor: opts.actor, taskId: opts.taskId, timestamps: [], lastAlertAt: 0 }
    attempts.set(key, record)
  }
  record.timestamps.push(now)

  // Prune old timestamps
  record.timestamps = record.timestamps.filter(t => now - t < FLIP_WINDOW_MS)

  // Check throttle
  const throttled = now - record.lastAlertAt < ALERT_THROTTLE_MS

  // Determine alert level
  const attemptCount = record.timestamps.length
  let alertType: 'unauthorized_approval' | 'flip_attempt' | 'burst_alert' = 'unauthorized_approval'
  let message: string

  if (attemptCount >= FLIP_THRESHOLD) {
    alertType = 'burst_alert'
    message = `🚨 ALERT: ${opts.actor} has made ${attemptCount} unauthorized approval attempts on "${opts.taskTitle}" (${opts.taskId}) in the last ${FLIP_WINDOW_MS / 60_000}m. Expected reviewer: ${opts.expectedReviewer}. Investigate immediately.`
  } else {
    message = `⚠️ Unauthorized approval attempt: ${opts.actor} tried to approve "${opts.taskTitle}" (${opts.taskId}). Only ${opts.expectedReviewer} can approve this task.`
  }

  // Log the alert
  alertLog.push({
    timestamp: now,
    type: alertType,
    taskId: opts.taskId,
    actor: opts.actor,
    expectedReviewer: opts.expectedReviewer,
    message,
    throttled,
  })
  if (alertLog.length > ALERT_LOG_MAX) {
    alertLog.splice(0, alertLog.length - ALERT_LOG_MAX)
  }

  // Post alert (unless throttled)
  if (!throttled) {
    record.lastAlertAt = now
    try {
      await chatManager.sendMessage({
        channel: 'general',
        from: 'security',
        content: message,
      })
    } catch {
      console.warn(`[MutationAlert] Could not post alert for ${opts.taskId}`)
    }
    console.log(`[MutationAlert] ${alertType}: actor=${opts.actor} task=${opts.taskId} reviewer=${opts.expectedReviewer} attempts=${attemptCount}`)
  } else {
    console.log(`[MutationAlert] Throttled ${alertType}: actor=${opts.actor} task=${opts.taskId} (${attemptCount} attempts)`)
  }
}

/**
 * Record and alert on reviewer approval flip attempts.
 * Called when reviewer_approved is toggled (true→false or false→true) rapidly.
 */
export async function alertFlipAttempt(opts: {
  taskId: string
  taskTitle: string
  actor: string
  fromValue: boolean
  toValue: boolean
  context: string
}): Promise<void> {
  const now = Date.now()
  const key = `flip:${opts.actor}:${opts.taskId}`

  // Record in audit ledger
  await recordAudit({
    timestamp: now,
    taskId: opts.taskId,
    actor: opts.actor,
    field: 'metadata.reviewer_approved',
    before: opts.fromValue,
    after: opts.toValue,
    context: `${opts.context} (flip detected)`,
  })

  // Track flip
  let record = attempts.get(key)
  if (!record) {
    record = { actor: opts.actor, taskId: opts.taskId, timestamps: [], lastAlertAt: 0 }
    attempts.set(key, record)
  }
  record.timestamps.push(now)
  record.timestamps = record.timestamps.filter(t => now - t < FLIP_WINDOW_MS)

  const flipCount = record.timestamps.length
  const throttled = now - record.lastAlertAt < ALERT_THROTTLE_MS

  if (flipCount >= 2 && !throttled) {
    const message = `⚠️ Approval flip detected: ${opts.actor} has toggled reviewer_approved ${flipCount}x on "${opts.taskTitle}" (${opts.taskId}) in the last ${FLIP_WINDOW_MS / 60_000}m. This may indicate indecision or manipulation.`

    record.lastAlertAt = now

    alertLog.push({
      timestamp: now,
      type: 'flip_attempt',
      taskId: opts.taskId,
      actor: opts.actor,
      expectedReviewer: opts.actor,
      message,
      throttled: false,
    })
    if (alertLog.length > ALERT_LOG_MAX) {
      alertLog.splice(0, alertLog.length - ALERT_LOG_MAX)
    }

    try {
      await chatManager.sendMessage({
        channel: 'general',
        from: 'security',
        content: message,
      })
    } catch {
      console.warn(`[MutationAlert] Could not post flip alert for ${opts.taskId}`)
    }
    console.log(`[MutationAlert] flip_attempt: actor=${opts.actor} task=${opts.taskId} flips=${flipCount}`)
  }
}

// ── Status / Retrieval ─────────────────────────────────────────────────────

export function getMutationAlertStatus(): {
  alertCount: number
  recentAlerts: typeof alertLog
  trackedAttempts: number
} {
  return {
    alertCount: alertLog.length,
    recentAlerts: alertLog.slice(-50),
    trackedAttempts: attempts.size,
  }
}

/**
 * Clean up old attempt records periodically.
 */
export function pruneOldAttempts(): void {
  const now = Date.now()
  for (const [key, record] of attempts) {
    record.timestamps = record.timestamps.filter(t => now - t < FLIP_WINDOW_MS)
    if (record.timestamps.length === 0) {
      attempts.delete(key)
    }
  }
}
