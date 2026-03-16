// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Notification Delivery Worker
 *
 * Polls agent_notifications for pending rows and delivers them to active agents.
 * Respects interruption budget: agents with budget=closed skip non-urgent notifications.
 *
 * Delivery surface: chat DM (channel: 'notifications') or task comment when task_id is set.
 * Marks notifications as delivered (status='delivered') or failed after one retry.
 *
 * task-1773659376304
 */

import type Database from 'better-sqlite3'
import type { AgentNotification, NotificationPriorityLevel } from './agent-notifications.js'
import type { PresenceManager } from './presence.js'

// ── Types ──────────────────────────────────────────────────────────────────

export type InterruptionBudget = 'open' | 'focused' | 'closed'

export interface DeliveryTarget {
  agent: string
  isActive: boolean
  budget: InterruptionBudget
}

export interface DeliveryResult {
  notificationId: string
  delivered: boolean
  reason?: string
}

export interface NotificationWorkerConfig {
  /** Poll interval in ms (default: 30000 = 30s) */
  pollIntervalMs?: number
  /** Max notifications to process per tick (default: 20) */
  batchSize?: number
  /** Max age before expiring undelivered notifications (default: 24h) */
  expireAfterMs?: number
}

// ── Interruption budget ────────────────────────────────────────────────────

/** Map presence status to interruption budget */
function presenceToBudget(status: string): InterruptionBudget {
  switch (status) {
    case 'working': return 'focused'
    case 'reviewing': return 'focused'
    case 'blocked': return 'open'
    case 'waiting': return 'open'
    case 'idle': return 'open'
    case 'offline': return 'closed'
    default: return 'open'
  }
}

/** Whether a notification can interrupt at this budget level */
function canInterrupt(priority: NotificationPriorityLevel, budget: InterruptionBudget): boolean {
  if (budget === 'open') return true
  if (budget === 'focused') return priority === 'critical' || priority === 'high'
  // closed: only critical
  return priority === 'critical'
}

// ── Delivery helpers ───────────────────────────────────────────────────────

function formatNotificationMessage(notification: AgentNotification): string {
  const emoji =
    notification.priority === 'critical' ? '🚨' :
    notification.priority === 'high' ? '🔴' :
    notification.priority === 'medium' ? '📋' : 'ℹ️'

  const source = notification.source_agent ? ` from @${notification.source_agent}` : ''
  const taskRef = notification.task_id ? ` (${notification.task_id})` : ''

  const lines = [
    `${emoji} **${notification.title}**${source}${taskRef}`,
  ]

  if (notification.body) {
    lines.push(notification.body)
  }

  lines.push(`_ID: ${notification.id} · Ack: POST /agent-notifications/${notification.id}/ack { decision: "seen"|"accept"|"defer"|"dismiss" }_`)

  return lines.join('\n')
}

// ── Worker class ───────────────────────────────────────────────────────────

export class NotificationDeliveryWorker {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly pollIntervalMs: number
  private readonly batchSize: number
  private readonly expireAfterMs: number
  private stats = {
    delivered: 0,
    skipped: 0,
    failed: 0,
    expired: 0,
    ticks: 0,
    lastTickAt: 0,
  }

  constructor(
    private readonly getDb: () => Database.Database,
    private readonly presenceManager: PresenceManager,
    private readonly sendMessage: (opts: { from: string; content: string; channel: string; metadata?: Record<string, unknown> }) => Promise<unknown>,
    private readonly postTaskComment?: (taskId: string, author: string, content: string) => Promise<unknown>,
    config?: NotificationWorkerConfig,
  ) {
    this.pollIntervalMs = config?.pollIntervalMs ?? 30_000
    this.batchSize = config?.batchSize ?? 20
    this.expireAfterMs = config?.expireAfterMs ?? 24 * 60 * 60 * 1000
  }

  /** Start the worker loop */
  start(): void {
    if (this.timer) return
    console.log(`[NotifWorker] Started (poll every ${this.pollIntervalMs / 1000}s, batch ${this.batchSize})`)
    // Run first tick after a short delay to let server warm up
    setTimeout(() => this.tick().catch(err => console.error('[NotifWorker] tick error:', err)), 5000)
    this.timer = setInterval(() => {
      this.tick().catch(err => console.error('[NotifWorker] tick error:', err))
    }, this.pollIntervalMs)
    this.timer.unref()
  }

  /** Stop the worker loop */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      console.log('[NotifWorker] Stopped')
    }
  }

  /** Get worker stats */
  getStats() {
    return { ...this.stats, running: this.timer !== null }
  }

  /** Process one batch of pending notifications */
  async tick(): Promise<DeliveryResult[]> {
    this.stats.ticks++
    this.stats.lastTickAt = Date.now()
    const db = this.getDb()
    const now = Date.now()
    const results: DeliveryResult[] = []

    // 1. Expire old notifications first
    const expired = db.prepare(`
      UPDATE agent_notifications
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?
    `).run(now)
    if (expired.changes > 0) {
      this.stats.expired += expired.changes
      console.log(`[NotifWorker] Expired ${expired.changes} notification(s)`)
    }

    // Also expire very old notifications without explicit expires_at
    const staleExpired = db.prepare(`
      UPDATE agent_notifications
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at IS NULL AND created_at < ?
    `).run(now - this.expireAfterMs)
    if (staleExpired.changes > 0) {
      this.stats.expired += staleExpired.changes
    }

    // 2. Fetch pending notifications, ordered by priority then age
    const pending = db.prepare(`
      SELECT * FROM agent_notifications
      WHERE status = 'pending'
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
        END,
        created_at ASC
      LIMIT ?
    `).all(this.batchSize) as Array<Record<string, unknown>>

    if (pending.length === 0) return results

    // 3. Deliver each notification
    for (const row of pending) {
      const notification = deserializeRow(row)
      const targetAgent = notification.target_agent

      // Check agent presence
      const presence = this.presenceManager.getPresence(targetAgent)
      const budget = presence ? presenceToBudget(presence.status) : 'closed'

      // Budget check
      if (!canInterrupt(notification.priority, budget)) {
        this.stats.skipped++
        results.push({ notificationId: notification.id, delivered: false, reason: `budget=${budget}, priority=${notification.priority}` })
        continue
      }

      // Attempt delivery
      let delivered = false
      let deliveryError: string | undefined

      try {
        if (notification.task_id && this.postTaskComment) {
          // Deliver as task comment when task_id is set
          await this.postTaskComment(notification.task_id, 'system', formatNotificationMessage(notification))
          delivered = true
        } else {
          // Deliver as DM via chat
          await this.sendMessage({
            from: 'system',
            content: formatNotificationMessage(notification),
            channel: 'notifications',
            metadata: { notification_id: notification.id, target_agent: targetAgent },
          })
          delivered = true
        }
      } catch (err) {
        deliveryError = err instanceof Error ? err.message : String(err)
        console.error(`[NotifWorker] Delivery failed for ${notification.id}:`, deliveryError)

        // Retry once
        try {
          await this.sendMessage({
            from: 'system',
            content: formatNotificationMessage(notification),
            channel: 'notifications',
            metadata: { notification_id: notification.id, target_agent: targetAgent, retry: true },
          })
          delivered = true
          deliveryError = undefined
        } catch (retryErr) {
          deliveryError = retryErr instanceof Error ? retryErr.message : String(retryErr)
        }
      }

      // Update status
      if (delivered) {
        db.prepare(`
          UPDATE agent_notifications
          SET status = 'delivered', ack_at = ?
          WHERE id = ?
        `).run(now, notification.id)
        this.stats.delivered++
        results.push({ notificationId: notification.id, delivered: true })
      } else {
        db.prepare(`
          UPDATE agent_notifications
          SET status = 'failed', metadata = json_set(COALESCE(metadata, '{}'), '$.delivery_error', ?)
          WHERE id = ?
        `).run(deliveryError ?? 'unknown', notification.id)
        this.stats.failed++
        results.push({ notificationId: notification.id, delivered: false, reason: deliveryError })
      }
    }

    if (results.length > 0) {
      const delivered = results.filter(r => r.delivered).length
      const skipped = results.filter(r => !r.delivered).length
      console.log(`[NotifWorker] Processed ${results.length}: ${delivered} delivered, ${skipped} skipped/failed`)
    }

    return results
  }
}

// ── Row deserialization ────────────────────────────────────────────────────

function deserializeRow(row: Record<string, unknown>): AgentNotification {
  return {
    id: String(row.id),
    target_agent: String(row.target_agent),
    source_agent: row.source_agent ? String(row.source_agent) : null,
    type: String(row.type) as AgentNotification['type'],
    title: String(row.title),
    body: row.body ? String(row.body) : null,
    priority: String(row.priority) as AgentNotification['priority'],
    status: String(row.status) as AgentNotification['status'],
    ack_decision: row.ack_decision ? String(row.ack_decision) as AgentNotification['ack_decision'] : null,
    ack_at: typeof row.ack_at === 'number' ? row.ack_at : null,
    task_id: row.task_id ? String(row.task_id) : null,
    metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata as Record<string, unknown>) : null,
    created_at: typeof row.created_at === 'number' ? row.created_at : Date.now(),
    expires_at: typeof row.expires_at === 'number' ? row.expires_at : null,
  }
}
