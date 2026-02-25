import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { startReminderEngine, stopReminderEngine, getReminderEngineStats } from '../src/calendar-reminder-engine.js'
import { calendarEvents } from '../src/calendar-events.js'

function clearAllEvents() {
  const events = calendarEvents.listEvents({ limit: 500 })
  for (const e of events) calendarEvents.deleteEvent(e.id)
}

describe('Calendar Reminder Engine', () => {
  beforeEach(() => {
    clearAllEvents()
    stopReminderEngine()
  })

  afterEach(() => {
    stopReminderEngine()
  })

  it('starts and stops cleanly', () => {
    startReminderEngine()
    const stats = getReminderEngineStats()
    expect(stats.running).toBe(true)
    expect(stats.poll_interval_ms).toBe(30000)

    stopReminderEngine()
    const stats2 = getReminderEngineStats()
    expect(stats2.running).toBe(false)
  })

  it('reports stats after startup', () => {
    startReminderEngine()
    const stats = getReminderEngineStats()
    expect(stats.total_polls).toBeGreaterThanOrEqual(1) // Initial poll fires immediately
    expect(stats.last_poll_at).toBeGreaterThan(0)
  })

  it('does not double-start', () => {
    startReminderEngine()
    startReminderEngine() // Should be no-op
    const stats = getReminderEngineStats()
    expect(stats.running).toBe(true)
    stopReminderEngine()
  })

  it('delivers reminder for upcoming event', async () => {
    const now = Date.now()
    calendarEvents.createEvent({
      summary: 'Test meeting',
      dtstart: now + 5 * 60000, // 5 min from now
      dtend: now + 35 * 60000,
      organizer: 'ryan',
      attendees: [{ name: 'link', status: 'accepted' }],
      reminders: [{ minutes_before: 10, method: 'chat' }],
    })

    startReminderEngine()
    // Wait for initial poll to complete
    await new Promise(r => setTimeout(r, 100))

    const stats = getReminderEngineStats()
    expect(stats.total_delivered).toBeGreaterThanOrEqual(1)
  })
})
