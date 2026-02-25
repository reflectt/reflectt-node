import { describe, it, expect, beforeEach } from 'vitest'
import { calendarEvents } from '../src/calendar-events.js'

function clearAllEvents() {
  const events = calendarEvents.listEvents({ limit: 500 })
  for (const e of events) {
    calendarEvents.deleteEvent(e.id)
  }
}

describe('Calendar Events', () => {
  beforeEach(() => {
    clearAllEvents()
  })

  describe('CRUD', () => {
    it('creates a one-off event', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Team standup',
        description: 'Daily sync',
        dtstart: now + 60000,
        dtend: now + 60000 + 30 * 60000,
        organizer: 'ryan',
        attendees: [
          { name: 'link', status: 'needs-action' },
          { name: 'sage', status: 'accepted' },
        ],
        location: 'https://meet.example.com/standup',
        categories: ['meeting', 'daily'],
        reminders: [{ minutes_before: 10, method: 'chat' }],
      })

      expect(event.id).toMatch(/^evt-/)
      expect(event.uid).toContain('@reflectt.ai')
      expect(event.summary).toBe('Team standup')
      expect(event.organizer).toBe('ryan')
      expect(event.attendees).toHaveLength(2)
      expect(event.reminders).toHaveLength(1)
      expect(event.status).toBe('confirmed')
    })

    it('creates a recurring event with RRULE', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Weekly review',
        dtstart: now,
        dtend: now + 60 * 60000,
        organizer: 'sage',
        rrule: 'FREQ=WEEKLY;BYDAY=FR',
        timezone: 'America/Vancouver',
      })

      expect(event.rrule).toBe('FREQ=WEEKLY;BYDAY=FR')
      expect(event.timezone).toBe('America/Vancouver')
    })

    it('lists events filtered by organizer', () => {
      const now = Date.now()
      calendarEvents.createEvent({ summary: 'A', dtstart: now, dtend: now + 1000, organizer: 'ryan' })
      calendarEvents.createEvent({ summary: 'B', dtstart: now, dtend: now + 1000, organizer: 'link' })
      calendarEvents.createEvent({ summary: 'C', dtstart: now, dtend: now + 1000, organizer: 'ryan' })

      const ryanEvents = calendarEvents.listEvents({ organizer: 'ryan' })
      expect(ryanEvents).toHaveLength(2)
      expect(ryanEvents.every(e => e.organizer === 'ryan')).toBe(true)
    })

    it('lists events filtered by attendee', () => {
      const now = Date.now()
      calendarEvents.createEvent({
        summary: 'With link',
        dtstart: now, dtend: now + 1000,
        organizer: 'ryan',
        attendees: [{ name: 'link', status: 'accepted' }],
      })
      calendarEvents.createEvent({
        summary: 'Without link',
        dtstart: now, dtend: now + 1000,
        organizer: 'ryan',
        attendees: [{ name: 'sage', status: 'accepted' }],
      })

      const linkEvents = calendarEvents.listEvents({ attendee: 'link' })
      expect(linkEvents).toHaveLength(1)
      expect(linkEvents[0].summary).toBe('With link')
    })

    it('updates an event', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({ summary: 'Old', dtstart: now, dtend: now + 1000, organizer: 'ryan' })
      const updated = calendarEvents.updateEvent(event.id, { summary: 'New title', status: 'tentative' })

      expect(updated).not.toBeNull()
      expect(updated!.summary).toBe('New title')
      expect(updated!.status).toBe('tentative')
    })

    it('deletes an event', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({ summary: 'Delete me', dtstart: now, dtend: now + 1000, organizer: 'ryan' })
      expect(calendarEvents.deleteEvent(event.id)).toBe(true)
      expect(calendarEvents.getEvent(event.id)).toBeNull()
    })

    it('returns null for non-existent event', () => {
      expect(calendarEvents.getEvent('evt-nonexistent')).toBeNull()
      expect(calendarEvents.updateEvent('evt-nonexistent', { summary: 'Nope' })).toBeNull()
      expect(calendarEvents.deleteEvent('evt-nonexistent')).toBe(false)
    })
  })

  describe('RSVP', () => {
    it('updates existing attendee status', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Meeting',
        dtstart: now, dtend: now + 1000,
        organizer: 'ryan',
        attendees: [{ name: 'link', status: 'needs-action' }],
      })

      const updated = calendarEvents.rsvpEvent(event.id, 'link', 'accepted')
      expect(updated).not.toBeNull()
      const linkAttendee = updated!.attendees.find(a => a.name === 'link')
      expect(linkAttendee?.status).toBe('accepted')
      expect(linkAttendee?.rsvp_at).toBeGreaterThan(0)
    })

    it('adds new attendee via RSVP', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Open meeting',
        dtstart: now, dtend: now + 1000,
        organizer: 'ryan',
      })

      const updated = calendarEvents.rsvpEvent(event.id, 'pixel', 'accepted')
      expect(updated!.attendees).toHaveLength(1)
      expect(updated!.attendees[0].name).toBe('pixel')
      expect(updated!.attendees[0].status).toBe('accepted')
    })

    it('returns null for non-existent event', () => {
      expect(calendarEvents.rsvpEvent('evt-nonexistent', 'link', 'accepted')).toBeNull()
    })
  })

  describe('RRULE parsing', () => {
    it('parses simple weekly rule', () => {
      const parsed = calendarEvents.parseRRule('FREQ=WEEKLY;BYDAY=MO,WE,FR')
      expect(parsed.freq).toBe('WEEKLY')
      expect(parsed.byday).toEqual(['MO', 'WE', 'FR'])
      expect(parsed.interval).toBe(1)
    })

    it('parses daily with interval', () => {
      const parsed = calendarEvents.parseRRule('FREQ=DAILY;INTERVAL=2')
      expect(parsed.freq).toBe('DAILY')
      expect(parsed.interval).toBe(2)
    })

    it('parses monthly with count', () => {
      const parsed = calendarEvents.parseRRule('FREQ=MONTHLY;BYMONTHDAY=15;COUNT=12')
      expect(parsed.freq).toBe('MONTHLY')
      expect(parsed.bymonthday).toEqual([15])
      expect(parsed.count).toBe(12)
    })

    it('rejects missing FREQ', () => {
      expect(() => calendarEvents.parseRRule('BYDAY=MO')).toThrow('RRULE must contain FREQ')
    })

    it('rejects invalid frequency', () => {
      expect(() => calendarEvents.parseRRule('FREQ=HOURLY')).toThrow('Invalid RRULE frequency')
    })
  })

  describe('Occurrences', () => {
    it('returns one-off event in range', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'One-off',
        dtstart: now + 60000,
        dtend: now + 120000,
        organizer: 'ryan',
      })

      const occs = calendarEvents.getOccurrences(event, now, now + 200000)
      expect(occs).toHaveLength(1)
      expect(occs[0]).toBe(event.dtstart)
    })

    it('returns empty for one-off event out of range', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Past event',
        dtstart: now - 120000,
        dtend: now - 60000,
        organizer: 'ryan',
      })

      const occs = calendarEvents.getOccurrences(event, now, now + 200000)
      expect(occs).toHaveLength(0)
    })

    it('generates daily occurrences', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Daily check',
        dtstart: now,
        dtend: now + 30 * 60000,
        organizer: 'link',
        rrule: 'FREQ=DAILY',
      })

      const weekMs = 7 * 24 * 60 * 60 * 1000
      const occs = calendarEvents.getOccurrences(event, now, now + weekMs)
      expect(occs.length).toBeGreaterThanOrEqual(7)
    })

    it('generates weekly occurrences with BYDAY', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'MWF standup',
        dtstart: now,
        dtend: now + 30 * 60000,
        organizer: 'ryan',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      })

      const monthMs = 30 * 24 * 60 * 60 * 1000
      const occs = calendarEvents.getOccurrences(event, now, now + monthMs)
      // Should have roughly 12-13 occurrences in a month (3 per week × ~4.3 weeks)
      expect(occs.length).toBeGreaterThanOrEqual(10)
    })

    it('respects COUNT limit', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Limited',
        dtstart: now,
        dtend: now + 60000,
        organizer: 'link',
        rrule: 'FREQ=DAILY;COUNT=3',
      })

      const yearMs = 365 * 24 * 60 * 60 * 1000
      const occs = calendarEvents.getOccurrences(event, now, now + yearMs)
      expect(occs).toHaveLength(3)
    })
  })

  describe('Validation', () => {
    it('rejects missing summary', () => {
      const now = Date.now()
      expect(() => calendarEvents.createEvent({
        summary: '',
        dtstart: now, dtend: now + 1000,
        organizer: 'ryan',
      })).toThrow('summary is required')
    })

    it('rejects missing organizer', () => {
      const now = Date.now()
      expect(() => calendarEvents.createEvent({
        summary: 'Test',
        dtstart: now, dtend: now + 1000,
        organizer: '',
      })).toThrow('organizer is required')
    })

    it('rejects end before start', () => {
      const now = Date.now()
      expect(() => calendarEvents.createEvent({
        summary: 'Bad',
        dtstart: now + 1000, dtend: now,
        organizer: 'ryan',
      })).toThrow('dtend must be after dtstart')
    })

    it('rejects invalid attendee status', () => {
      const now = Date.now()
      expect(() => calendarEvents.createEvent({
        summary: 'Bad',
        dtstart: now, dtend: now + 1000,
        organizer: 'ryan',
        attendees: [{ name: 'link', status: 'invalid' as any }],
      })).toThrow('status must be one of')
    })

    it('rejects invalid reminder', () => {
      const now = Date.now()
      expect(() => calendarEvents.createEvent({
        summary: 'Bad',
        dtstart: now, dtend: now + 1000,
        organizer: 'ryan',
        reminders: [{ minutes_before: -5, method: 'chat' }],
      })).toThrow('non-negative number')
    })
  })

  describe('Agent availability', () => {
    it('detects agent in current event', () => {
      const now = Date.now()
      calendarEvents.createEvent({
        summary: 'Active meeting',
        dtstart: now - 10000,
        dtend: now + 60000,
        organizer: 'ryan',
        attendees: [{ name: 'link', status: 'accepted' }],
      })

      const current = calendarEvents.getAgentCurrentEvent('link', now)
      expect(current).not.toBeNull()
      expect(current!.summary).toBe('Active meeting')
    })

    it('returns null when no current event', () => {
      const now = Date.now()
      calendarEvents.createEvent({
        summary: 'Future meeting',
        dtstart: now + 60000,
        dtend: now + 120000,
        organizer: 'ryan',
        attendees: [{ name: 'link', status: 'accepted' }],
      })

      const current = calendarEvents.getAgentCurrentEvent('link', now)
      expect(current).toBeNull()
    })

    it('finds next upcoming event', () => {
      const now = Date.now()
      calendarEvents.createEvent({
        summary: 'Soon',
        dtstart: now + 30 * 60000,
        dtend: now + 60 * 60000,
        organizer: 'ryan',
        attendees: [{ name: 'link', status: 'accepted' }],
      })
      calendarEvents.createEvent({
        summary: 'Later',
        dtstart: now + 120 * 60000,
        dtend: now + 150 * 60000,
        organizer: 'ryan',
        attendees: [{ name: 'link', status: 'accepted' }],
      })

      const next = calendarEvents.getAgentNextEvent('link', now)
      expect(next).not.toBeNull()
      expect(next!.event.summary).toBe('Soon')
    })

    it('detects organizer in current event', () => {
      const now = Date.now()
      calendarEvents.createEvent({
        summary: 'My meeting',
        dtstart: now - 10000,
        dtend: now + 60000,
        organizer: 'link',
      })

      const current = calendarEvents.getAgentCurrentEvent('link', now)
      expect(current).not.toBeNull()
      expect(current!.summary).toBe('My meeting')
    })
  })

  describe('Reminders', () => {
    it('returns pending reminder when window opens', () => {
      const now = Date.now()
      calendarEvents.createEvent({
        summary: 'Upcoming meeting',
        dtstart: now + 5 * 60000, // 5 min from now
        dtend: now + 35 * 60000,
        organizer: 'ryan',
        attendees: [{ name: 'link', status: 'accepted' }],
        reminders: [{ minutes_before: 10, method: 'chat' }],
      })

      // At now, a 10-min reminder for an event 5 min away should fire
      const pending = calendarEvents.getPendingReminders(now)
      expect(pending).toHaveLength(1)
      expect(pending[0].deliver_to).toContain('ryan')
      expect(pending[0].deliver_to).toContain('link')
    })

    it('does not re-fire after marking as fired', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Meeting',
        dtstart: now + 5 * 60000,
        dtend: now + 35 * 60000,
        organizer: 'ryan',
        reminders: [{ minutes_before: 10, method: 'chat' }],
      })

      const pending1 = calendarEvents.getPendingReminders(now)
      expect(pending1).toHaveLength(1)

      // Mark as fired
      calendarEvents.markReminderFired(event.id, event.dtstart, 10, ['ryan'])

      const pending2 = calendarEvents.getPendingReminders(now)
      expect(pending2).toHaveLength(0)
    })

    it('excludes declined attendees from delivery', () => {
      const now = Date.now()
      calendarEvents.createEvent({
        summary: 'Meeting',
        dtstart: now + 5 * 60000,
        dtend: now + 35 * 60000,
        organizer: 'ryan',
        attendees: [
          { name: 'link', status: 'accepted' },
          { name: 'sage', status: 'declined' },
        ],
        reminders: [{ minutes_before: 10, method: 'chat' }],
      })

      const pending = calendarEvents.getPendingReminders(now)
      expect(pending[0].deliver_to).toContain('link')
      expect(pending[0].deliver_to).not.toContain('sage')
    })
  })
})
