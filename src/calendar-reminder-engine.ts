// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Calendar Reminder Engine — Polls for pending reminders and delivers via chat/inbox.
 *
 * Runs on a timer (every 30s), checks for reminders that should fire,
 * delivers them, and marks them as fired to prevent duplicates.
 */

import { calendarEvents, type PendingReminder } from './calendar-events.js'
import { chatManager } from './chat.js'

// ── Configuration ──────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30 * 1000 // Check every 30 seconds
const REMINDER_CHANNEL = 'calendar-reminders'

// ── State ──────────────────────────────────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null
let lastPollAt = 0
let totalDelivered = 0
let totalPolls = 0

// ── Reminder formatting ────────────────────────────────────────────────────

function formatReminderMessage(reminder: PendingReminder): string {
  const { event, minutes_before } = reminder
  const timeLabel = minutes_before >= 1440
    ? `${Math.round(minutes_before / 1440)} day${minutes_before >= 2880 ? 's' : ''}`
    : minutes_before >= 60
      ? `${Math.round(minutes_before / 60)} hour${minutes_before >= 120 ? 's' : ''}`
      : `${minutes_before} minute${minutes_before !== 1 ? 's' : ''}`

  const eventTime = new Date(reminder.occurrence_start)
  const timeStr = eventTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: event.timezone || 'UTC',
  })

  const parts = [`📅 **Reminder**: "${event.summary}" starts in ${timeLabel} (${timeStr})`]

  if (event.location) {
    parts.push(`📍 ${event.location}`)
  }

  if (event.attendees.length > 0) {
    const names = event.attendees
      .filter(a => a.status !== 'declined')
      .map(a => a.name)
      .join(', ')
    if (names) {
      parts.push(`👥 ${names}`)
    }
  }

  if (event.description) {
    // Truncate long descriptions
    const desc = event.description.length > 200
      ? event.description.slice(0, 200) + '...'
      : event.description
    parts.push(`📝 ${desc}`)
  }

  return parts.join('\n')
}

// ── Delivery ───────────────────────────────────────────────────────────────

async function deliverReminder(reminder: PendingReminder): Promise<void> {
  const message = formatReminderMessage(reminder)

  // Deliver to calendar-reminders channel
  try {
    await chatManager.sendMessage({
      from: 'calendar',
      channel: REMINDER_CHANNEL,
      content: message,
      metadata: {
        type: 'calendar_reminder',
        event_id: reminder.event.id,
        occurrence_start: reminder.occurrence_start,
        minutes_before: reminder.minutes_before,
        deliver_to: reminder.deliver_to,
      },
    })
  } catch {
    // Silent fail
  }

  // Also deliver to general channel with @mentions so agents see it
  try {
    const mentionList = reminder.deliver_to.map(n => `@${n}`).join(' ')
    await chatManager.sendMessage({
      from: 'calendar',
      channel: 'general',
      content: `${mentionList} ${message}`,
      metadata: {
        type: 'calendar_reminder',
        event_id: reminder.event.id,
      },
    })
  } catch {
    // Silent fail
  }

  // Mark as fired
  calendarEvents.markReminderFired(
    reminder.event.id,
    reminder.occurrence_start,
    reminder.minutes_before,
    reminder.deliver_to,
  )

  totalDelivered++
}

// ── Poll loop ──────────────────────────────────────────────────────────────

async function pollReminders(): Promise<number> {
  totalPolls++
  lastPollAt = Date.now()

  const pending = calendarEvents.getPendingReminders()
  if (pending.length === 0) return 0

  let delivered = 0
  for (const reminder of pending) {
    try {
      await deliverReminder(reminder)
      delivered++
    } catch (err) {
      // Log but don't crash the loop
      console.error(`[Calendar] Failed to deliver reminder for ${reminder.event.id}:`, err)
    }
  }

  return delivered
}

// ── Engine lifecycle ───────────────────────────────────────────────────────

export function startReminderEngine(): void {
  if (intervalHandle) return // Already running

  // Initial poll
  pollReminders().catch(() => {})

  intervalHandle = setInterval(() => {
    pollReminders().catch(() => {})
  }, POLL_INTERVAL_MS)

  console.log(`[Calendar] Reminder engine started (polling every ${POLL_INTERVAL_MS / 1000}s)`)
}

export function stopReminderEngine(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
    console.log('[Calendar] Reminder engine stopped')
  }
}

export function getReminderEngineStats(): {
  running: boolean
  poll_interval_ms: number
  last_poll_at: number
  total_polls: number
  total_delivered: number
} {
  return {
    running: !!intervalHandle,
    poll_interval_ms: POLL_INTERVAL_MS,
    last_poll_at: lastPollAt,
    total_polls: totalPolls,
    total_delivered: totalDelivered,
  }
}
