// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Notification Preferences
 *
 * Per-agent notification configuration:
 *   - Channel preferences (which channels each agent wants notifications from)
 *   - Priority thresholds (minimum priority to notify)
 *   - Quiet hours (suppress notifications during off hours)
 *   - Delivery method preferences (inbox, mention, both)
 *   - Event type filters (task_assigned, review_requested, etc.)
 *
 * Persisted in SQLite. Exposed via API for dashboard configuration.
 */

import { getDb } from './db.js'

// ── Types ──

export type DeliveryMethod = 'inbox' | 'mention' | 'both' | 'none'
export type NotificationPriority = 'all' | 'P1' | 'P2' | 'P3' | 'P4'

export interface NotificationPreferences {
  agent: string
  enabled: boolean
  deliveryMethod: DeliveryMethod
  priorityThreshold: NotificationPriority
  quietHours: {
    enabled: boolean
    startHour: number    // 0-23
    endHour: number      // 0-23
    timezone: string
  }
  eventFilters: {
    taskAssigned: boolean
    taskCompleted: boolean
    reviewRequested: boolean
    reviewApproved: boolean
    mentionInChat: boolean
    taskComment: boolean
    statusChange: boolean
    webhookFailure: boolean
  }
  channelSubscriptions: string[]  // which channels to receive from
  mutedUntil: number | null       // epoch ms, null = not muted
  updatedAt: number
}

export interface NotificationEvent {
  type: keyof NotificationPreferences['eventFilters']
  agent: string
  priority?: string
  channel?: string
  message: string
  metadata?: Record<string, unknown>
}

export interface NotificationRouteResult {
  shouldNotify: boolean
  reason: string
  deliveryMethod: DeliveryMethod
}

// ── Constants ──

const DEFAULT_PREFS: Omit<NotificationPreferences, 'agent' | 'updatedAt'> = {
  enabled: true,
  deliveryMethod: 'both',
  priorityThreshold: 'all',
  quietHours: {
    enabled: false,
    startHour: 22,
    endHour: 7,
    timezone: 'UTC',
  },
  eventFilters: {
    taskAssigned: true,
    taskCompleted: true,
    reviewRequested: true,
    reviewApproved: true,
    mentionInChat: true,
    taskComment: true,
    statusChange: true,
    webhookFailure: true,
  },
  channelSubscriptions: ['general', 'task-comments', 'reviews'],
  mutedUntil: null,
}

// ── Schema ──

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS notification_preferences (
    agent TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    delivery_method TEXT NOT NULL DEFAULT 'both',
    priority_threshold TEXT NOT NULL DEFAULT 'all',
    quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
    quiet_hours_start INTEGER NOT NULL DEFAULT 22,
    quiet_hours_end INTEGER NOT NULL DEFAULT 7,
    quiet_hours_tz TEXT NOT NULL DEFAULT 'UTC',
    event_filters TEXT NOT NULL DEFAULT '{}',
    channel_subscriptions TEXT NOT NULL DEFAULT '[]',
    muted_until INTEGER,
    updated_at INTEGER NOT NULL
  )
`

// ── Notification Preferences Manager ──

export class NotificationManager {
  private initialized = false

  init(): void {
    if (this.initialized) return
    const db = getDb()
    db.exec(CREATE_TABLE)
    this.initialized = true
  }

  /** Get preferences for an agent (returns defaults if none configured) */
  getPreferences(agent: string): NotificationPreferences {
    this.ensureInit()
    const db = getDb()
    const row = db.prepare(
      'SELECT * FROM notification_preferences WHERE agent = ?'
    ).get(agent) as NotificationPrefsRow | undefined

    if (!row) {
      return { agent, ...DEFAULT_PREFS, updatedAt: 0 }
    }

    return this.rowToPrefs(row)
  }

  /** Get preferences for all agents */
  getAllPreferences(): NotificationPreferences[] {
    this.ensureInit()
    const db = getDb()
    const rows = db.prepare(
      'SELECT * FROM notification_preferences ORDER BY agent'
    ).all() as NotificationPrefsRow[]

    return rows.map(r => this.rowToPrefs(r))
  }

  /** Update preferences for an agent (partial update) */
  updatePreferences(agent: string, patch: Partial<Omit<NotificationPreferences, 'agent' | 'updatedAt'>>): NotificationPreferences {
    this.ensureInit()
    const current = this.getPreferences(agent)
    const now = Date.now()

    const updated: NotificationPreferences = {
      ...current,
      ...patch,
      agent,
      quietHours: {
        ...current.quietHours,
        ...(patch.quietHours || {}),
      },
      eventFilters: {
        ...current.eventFilters,
        ...(patch.eventFilters || {}),
      },
      channelSubscriptions: patch.channelSubscriptions ?? current.channelSubscriptions,
      updatedAt: now,
    }

    const db = getDb()
    db.prepare(`
      INSERT INTO notification_preferences (
        agent, enabled, delivery_method, priority_threshold,
        quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_tz,
        event_filters, channel_subscriptions, muted_until, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent) DO UPDATE SET
        enabled = excluded.enabled,
        delivery_method = excluded.delivery_method,
        priority_threshold = excluded.priority_threshold,
        quiet_hours_enabled = excluded.quiet_hours_enabled,
        quiet_hours_start = excluded.quiet_hours_start,
        quiet_hours_end = excluded.quiet_hours_end,
        quiet_hours_tz = excluded.quiet_hours_tz,
        event_filters = excluded.event_filters,
        channel_subscriptions = excluded.channel_subscriptions,
        muted_until = excluded.muted_until,
        updated_at = excluded.updated_at
    `).run(
      updated.agent,
      updated.enabled ? 1 : 0,
      updated.deliveryMethod,
      updated.priorityThreshold,
      updated.quietHours.enabled ? 1 : 0,
      updated.quietHours.startHour,
      updated.quietHours.endHour,
      updated.quietHours.timezone,
      JSON.stringify(updated.eventFilters),
      JSON.stringify(updated.channelSubscriptions),
      updated.mutedUntil,
      updated.updatedAt,
    )

    return updated
  }

  /** Delete preferences for an agent (resets to defaults) */
  resetPreferences(agent: string): void {
    this.ensureInit()
    const db = getDb()
    db.prepare('DELETE FROM notification_preferences WHERE agent = ?').run(agent)
  }

  /** Mute notifications for an agent until a given time */
  mute(agent: string, untilMs: number): NotificationPreferences {
    return this.updatePreferences(agent, { mutedUntil: untilMs })
  }

  /** Unmute notifications for an agent */
  unmute(agent: string): NotificationPreferences {
    return this.updatePreferences(agent, { mutedUntil: null })
  }

  /**
   * Route a notification event through an agent's preferences.
   * Returns whether to notify and via which method.
   */
  shouldNotify(event: NotificationEvent): NotificationRouteResult {
    const prefs = this.getPreferences(event.agent)

    // Check if notifications are enabled
    if (!prefs.enabled) {
      return { shouldNotify: false, reason: 'notifications_disabled', deliveryMethod: 'none' }
    }

    // Check if muted
    if (prefs.mutedUntil && Date.now() < prefs.mutedUntil) {
      return { shouldNotify: false, reason: 'muted', deliveryMethod: 'none' }
    }

    // Check quiet hours
    if (prefs.quietHours.enabled && this.isQuietHours(prefs.quietHours)) {
      return { shouldNotify: false, reason: 'quiet_hours', deliveryMethod: 'none' }
    }

    // Check priority threshold
    if (event.priority && !this.meetsPriorityThreshold(event.priority, prefs.priorityThreshold)) {
      return { shouldNotify: false, reason: 'below_priority_threshold', deliveryMethod: 'none' }
    }

    // Check event filter
    if (!prefs.eventFilters[event.type]) {
      return { shouldNotify: false, reason: `event_type_${event.type}_disabled`, deliveryMethod: 'none' }
    }

    // Check channel subscription
    if (event.channel && prefs.channelSubscriptions.length > 0) {
      if (!prefs.channelSubscriptions.includes(event.channel)) {
        return { shouldNotify: false, reason: 'channel_not_subscribed', deliveryMethod: 'none' }
      }
    }

    return {
      shouldNotify: true,
      reason: 'preferences_match',
      deliveryMethod: prefs.deliveryMethod,
    }
  }

  // ── Private ──

  private ensureInit(): void {
    if (!this.initialized) this.init()
  }

  private isQuietHours(qh: NotificationPreferences['quietHours']): boolean {
    // Get current hour in the configured timezone
    let currentHour: number
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: qh.timezone,
      })
      currentHour = parseInt(formatter.format(new Date()), 10)
    } catch {
      currentHour = new Date().getUTCHours()
    }

    if (qh.startHour <= qh.endHour) {
      // Same-day range (e.g., 9-17)
      return currentHour >= qh.startHour && currentHour < qh.endHour
    } else {
      // Overnight range (e.g., 22-7)
      return currentHour >= qh.startHour || currentHour < qh.endHour
    }
  }

  private meetsPriorityThreshold(eventPriority: string, threshold: NotificationPriority): boolean {
    if (threshold === 'all') return true

    const priorityOrder = ['P1', 'P2', 'P3', 'P4']
    const eventIdx = priorityOrder.indexOf(eventPriority)
    const thresholdIdx = priorityOrder.indexOf(threshold)

    if (eventIdx === -1) return true // Unknown priority → allow
    return eventIdx <= thresholdIdx
  }

  private rowToPrefs(row: NotificationPrefsRow): NotificationPreferences {
    let eventFilters = DEFAULT_PREFS.eventFilters
    try {
      eventFilters = { ...DEFAULT_PREFS.eventFilters, ...JSON.parse(row.event_filters) }
    } catch {}

    let channelSubscriptions = DEFAULT_PREFS.channelSubscriptions
    try {
      channelSubscriptions = JSON.parse(row.channel_subscriptions)
    } catch {}

    return {
      agent: row.agent,
      enabled: row.enabled === 1,
      deliveryMethod: row.delivery_method as DeliveryMethod,
      priorityThreshold: row.priority_threshold as NotificationPriority,
      quietHours: {
        enabled: row.quiet_hours_enabled === 1,
        startHour: row.quiet_hours_start,
        endHour: row.quiet_hours_end,
        timezone: row.quiet_hours_tz,
      },
      eventFilters,
      channelSubscriptions,
      mutedUntil: row.muted_until,
      updatedAt: row.updated_at,
    }
  }
}

// ── Row type ──

interface NotificationPrefsRow {
  agent: string
  enabled: number
  delivery_method: string
  priority_threshold: string
  quiet_hours_enabled: number
  quiet_hours_start: number
  quiet_hours_end: number
  quiet_hours_tz: string
  event_filters: string
  channel_subscriptions: string
  muted_until: number | null
  updated_at: number
}

// ── Singleton ──

let _manager: NotificationManager | null = null

export function getNotificationManager(): NotificationManager {
  if (!_manager) {
    _manager = new NotificationManager()
  }
  return _manager
}
