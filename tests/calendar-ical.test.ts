import { describe, it, expect, beforeEach } from 'vitest'
import { exportICS, exportEventICS, importICS, parseICS } from '../src/calendar-ical.js'
import { calendarEvents } from '../src/calendar-events.js'

function clearAllEvents() {
  const events = calendarEvents.listEvents({ limit: 500 })
  for (const e of events) calendarEvents.deleteEvent(e.id)
}

describe('Calendar iCal', () => {
  beforeEach(() => {
    clearAllEvents()
  })

  describe('Export', () => {
    it('exports a simple event as valid .ics', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Team standup',
        description: 'Daily sync meeting',
        dtstart: now,
        dtend: now + 30 * 60000,
        organizer: 'ryan',
        location: 'https://meet.example.com',
        categories: ['meeting', 'daily'],
      })

      const ics = exportEventICS(event)

      expect(ics).toContain('BEGIN:VCALENDAR')
      expect(ics).toContain('END:VCALENDAR')
      expect(ics).toContain('BEGIN:VEVENT')
      expect(ics).toContain('END:VEVENT')
      expect(ics).toContain('SUMMARY:Team standup')
      expect(ics).toContain('DESCRIPTION:Daily sync meeting')
      expect(ics).toContain('LOCATION:https://meet.example.com')
      expect(ics).toContain('CATEGORIES:meeting,daily')
      expect(ics).toContain('PRODID:-//Reflectt AI//Calendar v1//EN')
      expect(ics).toContain(`UID:${event.uid}`)
    })

    it('exports attendees with PARTSTAT', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Review',
        dtstart: now, dtend: now + 60000,
        organizer: 'ryan',
        attendees: [
          { name: 'link', status: 'accepted' },
          { name: 'sage', status: 'declined' },
          { name: 'pixel', status: 'tentative' },
        ],
      })

      const ics = exportEventICS(event)
      expect(ics).toContain('ATTENDEE;CN=link;PARTSTAT=ACCEPTED')
      expect(ics).toContain('ATTENDEE;CN=sage;PARTSTAT=DECLINED')
      expect(ics).toContain('ATTENDEE;CN=pixel;PARTSTAT=TENTATIVE')
    })

    it('exports VALARM for reminders', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Reminder test',
        dtstart: now, dtend: now + 60000,
        organizer: 'ryan',
        reminders: [
          { minutes_before: 10, method: 'chat' },
          { minutes_before: 60, method: 'chat' },
        ],
      })

      const ics = exportEventICS(event)
      expect(ics).toContain('BEGIN:VALARM')
      expect(ics).toContain('TRIGGER:-PT10M')
      expect(ics).toContain('TRIGGER:-PT60M')
      expect(ics).toContain('END:VALARM')
    })

    it('exports RRULE for recurring events', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Weekly review',
        dtstart: now, dtend: now + 60000,
        organizer: 'sage',
        rrule: 'FREQ=WEEKLY;BYDAY=FR',
      })

      const ics = exportEventICS(event)
      expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=FR')
    })

    it('exports multiple events', () => {
      const now = Date.now()
      calendarEvents.createEvent({ summary: 'Event A', dtstart: now, dtend: now + 60000, organizer: 'ryan' })
      calendarEvents.createEvent({ summary: 'Event B', dtstart: now, dtend: now + 60000, organizer: 'link' })

      const events = calendarEvents.listEvents()
      const ics = exportICS(events)

      const veventCount = (ics.match(/BEGIN:VEVENT/g) || []).length
      expect(veventCount).toBe(2)
    })
  })

  describe('Parse', () => {
    it('parses a simple VEVENT', () => {
      const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:test-123@example.com
SUMMARY:Test Event
DTSTART:20260301T090000Z
DTEND:20260301T100000Z
LOCATION:Office
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`

      const events = parseICS(ics)
      expect(events).toHaveLength(1)
      expect(events[0].summary).toBe('Test Event')
      expect(events[0].location).toBe('Office')
      expect(events[0].status).toBe('confirmed')
      expect(events[0].uid).toBe('test-123@example.com')
    })

    it('parses attendees with PARTSTAT', () => {
      const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Meeting
DTSTART:20260301T090000Z
DTEND:20260301T100000Z
ORGANIZER;CN=Ryan:mailto:ryan@reflectt.ai
ATTENDEE;CN=Link;PARTSTAT=ACCEPTED:mailto:link@reflectt.ai
ATTENDEE;CN=Sage;PARTSTAT=DECLINED:mailto:sage@reflectt.ai
END:VEVENT
END:VCALENDAR`

      const events = parseICS(ics)
      expect(events[0].attendees).toHaveLength(2)
      expect(events[0].attendees[0].name).toBe('Link')
      expect(events[0].attendees[0].status).toBe('accepted')
      expect(events[0].attendees[1].name).toBe('Sage')
      expect(events[0].attendees[1].status).toBe('declined')
      expect(events[0].organizer).toBe('Ryan')
    })

    it('parses VALARM as reminders', () => {
      const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Alarm test
DTSTART:20260301T090000Z
DTEND:20260301T100000Z
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT15M
DESCRIPTION:Reminder
END:VALARM
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT1H
END:VALARM
END:VEVENT
END:VCALENDAR`

      const events = parseICS(ics)
      expect(events[0].reminders).toHaveLength(2)
      expect(events[0].reminders[0].minutes_before).toBe(15)
      expect(events[0].reminders[1].minutes_before).toBe(60)
    })

    it('parses RRULE', () => {
      const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Weekly
DTSTART:20260301T090000Z
DTEND:20260301T100000Z
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR
END:VEVENT
END:VCALENDAR`

      const events = parseICS(ics)
      expect(events[0].rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR')
    })

    it('parses CATEGORIES', () => {
      const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Tagged
DTSTART:20260301T090000Z
DTEND:20260301T100000Z
CATEGORIES:meeting,important,daily
END:VEVENT
END:VCALENDAR`

      const events = parseICS(ics)
      expect(events[0].categories).toEqual(['meeting', 'important', 'daily'])
    })

    it('handles escaped text', () => {
      const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Meeting\\, with comma
DESCRIPTION:Line 1\\nLine 2\\nLine 3
DTSTART:20260301T090000Z
DTEND:20260301T100000Z
END:VEVENT
END:VCALENDAR`

      const events = parseICS(ics)
      expect(events[0].summary).toBe('Meeting, with comma')
      expect(events[0].description).toBe('Line 1\nLine 2\nLine 3')
    })

    it('handles folded lines', () => {
      const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:This is a very long summary that needs to be folded across multiple
  lines according to RFC 5545
DTSTART:20260301T090000Z
DTEND:20260301T100000Z
END:VEVENT
END:VCALENDAR`

      const events = parseICS(ics)
      expect(events[0].summary).toContain('very long summary')
      expect(events[0].summary).toContain('multiple lines')
    })

    it('parses multiple VEVENTs', () => {
      const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Event One
DTSTART:20260301T090000Z
DTEND:20260301T100000Z
END:VEVENT
BEGIN:VEVENT
SUMMARY:Event Two
DTSTART:20260302T090000Z
DTEND:20260302T100000Z
END:VEVENT
END:VCALENDAR`

      const events = parseICS(ics)
      expect(events).toHaveLength(2)
      expect(events[0].summary).toBe('Event One')
      expect(events[1].summary).toBe('Event Two')
    })
  })

  describe('Import', () => {
    it('imports events from .ics content', () => {
      const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:import-test-1@example.com
SUMMARY:Imported Meeting
DTSTART:20260401T140000Z
DTEND:20260401T150000Z
ORGANIZER;CN=External:mailto:external@example.com
ATTENDEE;CN=Link;PARTSTAT=NEEDS-ACTION:mailto:link@reflectt.ai
LOCATION:Zoom
CATEGORIES:external,meeting
BEGIN:VALARM
TRIGGER:-PT10M
ACTION:DISPLAY
DESCRIPTION:Reminder
END:VALARM
END:VEVENT
END:VCALENDAR`

      const imported = importICS(ics)
      expect(imported).toHaveLength(1)
      expect(imported[0].summary).toBe('Imported Meeting')
      expect(imported[0].organizer).toBe('External')
      expect(imported[0].attendees).toHaveLength(1)
      expect(imported[0].attendees[0].name).toBe('Link')
      expect(imported[0].location).toBe('Zoom')
      expect(imported[0].reminders).toHaveLength(1)
      expect(imported[0].reminders[0].minutes_before).toBe(10)

      // Verify it's actually in the database
      const stored = calendarEvents.getEvent(imported[0].id)
      expect(stored).not.toBeNull()
      expect(stored!.summary).toBe('Imported Meeting')
    })

    it('updates existing event on re-import (same UID)', () => {
      const ics1 = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:dedup-test@example.com
SUMMARY:Original Title
DTSTART:20260401T140000Z
DTEND:20260401T150000Z
END:VEVENT
END:VCALENDAR`

      const ics2 = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:dedup-test@example.com
SUMMARY:Updated Title
DTSTART:20260401T140000Z
DTEND:20260401T160000Z
END:VEVENT
END:VCALENDAR`

      const first = importICS(ics1, 'ryan')
      expect(first).toHaveLength(1)
      expect(first[0].summary).toBe('Original Title')

      const second = importICS(ics2, 'ryan')
      expect(second).toHaveLength(1)
      expect(second[0].summary).toBe('Updated Title')
      expect(second[0].id).toBe(first[0].id) // Same event, updated
    })

    it('skips events with no summary', () => {
      const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20260401T140000Z
DTEND:20260401T150000Z
END:VEVENT
END:VCALENDAR`

      const imported = importICS(ics)
      expect(imported).toHaveLength(0)
    })
  })

  describe('Round-trip', () => {
    it('export then import preserves event data', () => {
      const now = Date.now()
      const original = calendarEvents.createEvent({
        summary: 'Round trip test',
        description: 'Testing export/import cycle',
        dtstart: now + 60000,
        dtend: now + 120000,
        organizer: 'ryan',
        attendees: [
          { name: 'link', status: 'accepted' },
          { name: 'sage', status: 'tentative' },
        ],
        location: 'Conference Room',
        categories: ['test', 'qa'],
        reminders: [{ minutes_before: 15, method: 'chat' }],
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
      })

      // Export
      const ics = exportEventICS(original)

      // Delete original
      calendarEvents.deleteEvent(original.id)

      // Import
      const imported = importICS(ics)
      expect(imported).toHaveLength(1)

      const reimported = imported[0]
      expect(reimported.summary).toBe('Round trip test')
      expect(reimported.description).toBe('Testing export/import cycle')
      expect(reimported.organizer).toBe('ryan')
      expect(reimported.location).toBe('Conference Room')
      expect(reimported.categories).toEqual(['test', 'qa'])
      expect(reimported.rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
      expect(reimported.attendees).toHaveLength(2)
      expect(reimported.reminders).toHaveLength(1)
      expect(reimported.reminders[0].minutes_before).toBe(15)
    })
  })
})
