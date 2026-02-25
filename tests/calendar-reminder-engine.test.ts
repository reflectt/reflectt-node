import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { calendarEvents } from '../src/calendar-events.js'
import {
  startReminderEngine,
  stopReminderEngine,
  triggerPoll,
  getReminderEngineStatus,
} from '../src/calendar-reminder-engine.js'
import { chatManager } from '../src/chat.js'

// ── Helpers ────────────────────────────────────────────────────────────────

function clearAllEvents() {
  const events = calendarEvents.listEvents({ limit: 500 })
  for (const e of events) {
    calendarEvents.deleteEvent(e.id)
  }
}

describe('Calendar Reminder Engine', () => {
  beforeEach(() => {
    clearAllEvents()
    stopReminderEngine()
  })

  afterEach(() => {
    stopReminderEngine()
    vi.restoreAllMocks()
  })

  describe('getReminderEngineStatus', () => {
    it('reports not running by default', () => {
      const status = getReminderEngineStatus()
      expect(status.running).toBe(false)
      expect(status.pollIntervalMs).toBe(60_000)
    })

    it('reports running after start', () => {
      startReminderEngine()
      const status = getReminderEngineStatus()
      expect(status.running).toBe(true)
      stopReminderEngine()
    })

    it('is idempotent — double start is safe', () => {
      startReminderEngine()
      startReminderEngine() // no crash
      expect(getReminderEngineStatus().running).toBe(true)
      stopReminderEngine()
    })

    it('reports stopped after stop', () => {
      startReminderEngine()
      stopReminderEngine()
      expect(getReminderEngineStatus().running).toBe(false)
    })
  })

  describe('triggerPoll', () => {
    it('returns 0 when no events exist', async () => {
      const fired = await triggerPoll()
      expect(fired).toBe(0)
    })

    it('returns 0 for events with no reminders', async () => {
      const now = Date.now()
      calendarEvents.createEvent({
        summary: 'No reminder event',
        dtstart: now + 5 * 60_000,  // 5 min from now
        dtend: now + 35 * 60_000,
        organizer: 'link',
        reminders: [],
      })

      const fired = await triggerPoll()
      expect(fired).toBe(0)
    })

    it('fires a reminder when window opens', async () => {
      const sendSpy = vi.spyOn(chatManager, 'sendMessage').mockResolvedValue({
        id: 'test-msg',
        from: 'system',
        content: 'test',
        timestamp: Date.now(),
        channel: 'general',
      })

      const now = Date.now()
      // Create event starting in 5 minutes with a 10-minute reminder
      // This means the reminder should fire NOW (10 min before = 5 min ago)
      calendarEvents.createEvent({
        summary: 'Team standup',
        dtstart: now + 5 * 60_000,
        dtend: now + 35 * 60_000,
        organizer: 'link',
        attendees: [{ name: 'sage', status: 'accepted' }],
        reminders: [{ minutes_before: 10, method: 'chat' }],
      })

      const fired = await triggerPoll()
      expect(fired).toBe(1)
      expect(sendSpy).toHaveBeenCalledTimes(1)

      const call = sendSpy.mock.calls[0][0]
      expect(call.from).toBe('system')
      expect(call.content).toContain('Team standup')
      expect(call.content).toContain('@link')
      expect(call.content).toContain('@sage')
      expect((call.metadata as any)?.kind).toBe('calendar_reminder')
    })

    it('does not re-fire already-fired reminders', async () => {
      const sendSpy = vi.spyOn(chatManager, 'sendMessage').mockResolvedValue({
        id: 'test-msg',
        from: 'system',
        content: 'test',
        timestamp: Date.now(),
        channel: 'general',
      })

      const now = Date.now()
      calendarEvents.createEvent({
        summary: 'Dedup test',
        dtstart: now + 5 * 60_000,
        dtend: now + 35 * 60_000,
        organizer: 'link',
        reminders: [{ minutes_before: 10, method: 'chat' }],
      })

      // First poll — fires
      const fired1 = await triggerPoll()
      expect(fired1).toBe(1)

      // Second poll — should NOT re-fire (dedup via SQLite)
      const fired2 = await triggerPoll()
      expect(fired2).toBe(0)

      // Only one actual delivery
      expect(sendSpy).toHaveBeenCalledTimes(1)
    })

    it('delivers inbox reminders as DMs', async () => {
      const sendSpy = vi.spyOn(chatManager, 'sendMessage').mockResolvedValue({
        id: 'test-msg',
        from: 'system',
        content: 'test',
        timestamp: Date.now(),
        channel: 'general',
      })

      const now = Date.now()
      calendarEvents.createEvent({
        summary: 'Private reminder',
        dtstart: now + 5 * 60_000,
        dtend: now + 35 * 60_000,
        organizer: 'link',
        attendees: [{ name: 'sage', status: 'accepted' }],
        reminders: [{ minutes_before: 10, method: 'inbox' }],
      })

      const fired = await triggerPoll()
      expect(fired).toBe(1)

      // Inbox method sends DM to each attendee (link + sage = 2 calls)
      expect(sendSpy).toHaveBeenCalledTimes(2)

      // Both calls should have a `to` field (DM)
      expect(sendSpy.mock.calls[0][0].to).toBe('link')
      expect(sendSpy.mock.calls[1][0].to).toBe('sage')
    })

    it('skips declined attendees', async () => {
      const sendSpy = vi.spyOn(chatManager, 'sendMessage').mockResolvedValue({
        id: 'test-msg',
        from: 'system',
        content: 'test',
        timestamp: Date.now(),
        channel: 'general',
      })

      const now = Date.now()
      calendarEvents.createEvent({
        summary: 'Skip declined',
        dtstart: now + 5 * 60_000,
        dtend: now + 35 * 60_000,
        organizer: 'link',
        attendees: [
          { name: 'sage', status: 'accepted' },
          { name: 'echo', status: 'declined' },
        ],
        reminders: [{ minutes_before: 10, method: 'inbox' }],
      })

      const fired = await triggerPoll()
      expect(fired).toBe(1)

      // Only link (organizer) and sage (accepted) — not echo (declined)
      expect(sendSpy).toHaveBeenCalledTimes(2)
      const recipients = sendSpy.mock.calls.map(c => c[0].to)
      expect(recipients).toContain('link')
      expect(recipients).toContain('sage')
      expect(recipients).not.toContain('echo')
    })

    it('tracks totalFired in status', async () => {
      vi.spyOn(chatManager, 'sendMessage').mockResolvedValue({
        id: 'test-msg',
        from: 'system',
        content: 'test',
        timestamp: Date.now(),
        channel: 'general',
      })

      const now = Date.now()
      calendarEvents.createEvent({
        summary: 'Counter test',
        dtstart: now + 5 * 60_000,
        dtend: now + 35 * 60_000,
        organizer: 'link',
        reminders: [{ minutes_before: 10, method: 'chat' }],
      })

      const before = getReminderEngineStatus().totalFired
      await triggerPoll()
      const after = getReminderEngineStatus().totalFired
      expect(after).toBe(before + 1)
    })
  })

  describe('reminder message formatting', () => {
    it('includes event summary and attendee mentions', async () => {
      const sendSpy = vi.spyOn(chatManager, 'sendMessage').mockResolvedValue({
        id: 'test-msg',
        from: 'system',
        content: 'test',
        timestamp: Date.now(),
        channel: 'general',
      })

      const now = Date.now()
      calendarEvents.createEvent({
        summary: 'Sprint planning',
        dtstart: now + 5 * 60_000,
        dtend: now + 65 * 60_000,
        organizer: 'kai',
        attendees: [
          { name: 'link', status: 'accepted' },
          { name: 'pixel', status: 'tentative' },
        ],
        location: 'https://meet.reflectt.ai/sprint',
        reminders: [{ minutes_before: 10, method: 'chat' }],
      })

      await triggerPoll()

      const content = sendSpy.mock.calls[0][0].content
      expect(content).toContain('📅')
      expect(content).toContain('Sprint planning')
      expect(content).toContain('10 minutes')
      expect(content).toContain('@kai')
      expect(content).toContain('@link')
      expect(content).toContain('@pixel')
      expect(content).toContain('https://meet.reflectt.ai/sprint')
    })
  })
})
