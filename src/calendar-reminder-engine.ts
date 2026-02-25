// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Calendar Reminder Engine
 *
 * Polls upcoming events every 60s, fires reminders via chat,
 * and tracks fired reminders in SQLite to survive restarts.
 *
 * Delivery methods:
 * - 'chat': posts to #general (or configured channel) mentioning attendees
 * - 'inbox': sends DM to each attendee (routed through chatManager)
 */

import { calendarEvents, type PendingReminder } from './calendar-events.js'
import { chatManager } from './chat.js'

// ── Configuration ──────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000  // check every 60s
const DEFAULT_CHANNEL = 'general'

// ── Engine state ───────────────────────────────────────────────────────────

let pollTimer: NodeJS.Timeout | null = null
let running = false
let lastPollAt = 0
let totalFired = 0
let lastError: string | null = null

// ── Reminder formatting ────────────────────────────────────────────────────

function formatReminderMessage(reminder: PendingReminder): string {
  const { event, minutes_before, deliver_to } = reminder
  const timeLabel = formatTimeLabel(minutes_before)
  const mentions = deliver_to.map(name => `@${name}`).join(', ')
  const location = event.location ? ` — ${event.location}` : ''

  return `📅 **Reminder:** "${event.summary}" starts in ${timeLabel}. ${mentions}${location}`
}

function formatTimeLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`
  if (minutes === 60) return '1 hour'
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return mins > 0 ? `${hours}h ${mins}m` : `${hours} hour${hours !== 1 ? 's' : ''}`
  }
  const days = Math.floor(minutes / 1440)
  return `${days} day${days !== 1 ? 's' : ''}`
}

// ── Delivery ───────────────────────────────────────────────────────────────

async function deliverReminder(reminder: PendingReminder): Promise<boolean> {
  try {
    const message = formatReminderMessage(reminder)

    if (reminder.method === 'inbox') {
      // Send as DM to each attendee
      for (const name of reminder.deliver_to) {
        await chatManager.sendMessage({
          from: 'system',
          to: name,
          content: message,
          channel: 'general',
          metadata: {
            kind: 'calendar_reminder',
            event_id: reminder.event.id,
            minutes_before: reminder.minutes_before,
            bypass_budget: true,
          },
        })
      }
    } else {
      // Default: post to chat channel
      await chatManager.sendMessage({
        from: 'system',
        content: message,
        channel: DEFAULT_CHANNEL,
        metadata: {
          kind: 'calendar_reminder',
          event_id: reminder.event.id,
          minutes_before: reminder.minutes_before,
          bypass_budget: true,
        },
      })
    }

    return true
  } catch (err: any) {
    console.error(`[CalendarReminders] Failed to deliver reminder for event ${reminder.event.id}:`, err?.message)
    lastError = err?.message || 'unknown error'
    return false
  }
}

// ── Poll loop ──────────────────────────────────────────────────────────────

async function pollReminders(): Promise<number> {
  try {
    const pending = calendarEvents.getPendingReminders()
    lastPollAt = Date.now()

    if (pending.length === 0) return 0

    let fired = 0
    for (const reminder of pending) {
      const delivered = await deliverReminder(reminder)
      if (delivered) {
        // Mark as fired so it won't fire again (survives restarts via SQLite)
        calendarEvents.markReminderFired(
          reminder.event.id,
          reminder.occurrence_start,
          reminder.minutes_before,
          reminder.deliver_to,
        )
        fired++
        totalFired++
      }
    }

    if (fired > 0) {
      console.log(`[CalendarReminders] Fired ${fired} reminder(s)`)
    }

    return fired
  } catch (err: any) {
    console.error('[CalendarReminders] Poll error:', err?.message)
    lastError = err?.message || 'unknown error'
    return 0
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Start the reminder engine. Polls every 60s.
 * Safe to call multiple times (idempotent).
 */
export function startReminderEngine(): void {
  if (running) return
  running = true

  console.log('[CalendarReminders] Starting reminder engine (poll every 60s)')

  // Fire immediately on start, then every 60s
  void pollReminders()
  pollTimer = setInterval(() => void pollReminders(), POLL_INTERVAL_MS)
}

/**
 * Stop the reminder engine.
 */
export function stopReminderEngine(): void {
  if (!running) return
  running = false

  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }

  console.log('[CalendarReminders] Stopped reminder engine')
}

/**
 * Force a poll (for testing or manual trigger).
 */
export async function triggerPoll(): Promise<number> {
  return pollReminders()
}

/**
 * Get engine status for health/debug.
 */
export function getReminderEngineStatus(): {
  running: boolean
  lastPollAt: number
  totalFired: number
  lastError: string | null
  pollIntervalMs: number
} {
  return {
    running,
    lastPollAt,
    totalFired,
    lastError,
    pollIntervalMs: POLL_INTERVAL_MS,
  }
}
