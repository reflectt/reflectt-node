import { describe, it, expect, beforeEach } from 'vitest'
import { calendarEvents } from '../src/calendar-events.js'
import { exportToIcs, exportEventToIcs, parseIcs, importFromIcs } from '../src/calendar-ical.js'

function clearAllEvents() {
  const events = calendarEvents.listEvents({ limit: 500 })
  for (const e of events) {
    calendarEvents.deleteEvent(e.id)
  }
}

describe('Calendar iCal Import/Export', () => {
  beforeEach(() => {
    clearAllEvents()
  })

  describe('Export', () => {
    it('exports a simple event to valid ICS', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Team standup',
        description: 'Daily sync meeting',
        dtstart: now,
        dtend: now + 30 * 60_000,
        organizer: 'link',
        location: 'https://meet.example.com',
      })

      const ics = exportEventToIcs(event)

      expect(ics).toContain('BEGIN:VCALENDAR')
      expect(ics).toContain('END:VCALENDAR')
      expect(ics).toContain('BEGIN:VEVENT')
      expect(ics).toContain('END:VEVENT')
      expect(ics).toContain('VERSION:2.0')
      expect(ics).toContain(`UID:${event.uid}`)
      expect(ics).toContain('SUMMARY:Team standup')
      expect(ics).toContain('DESCRIPTION:Daily sync meeting')
      expect(ics).toContain('LOCATION:https://meet.example.com')
      expect(ics).toContain('ORGANIZER;CN=link:mailto:link@reflectt.ai')
    })

    it('exports RRULE correctly', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Weekly review',
        dtstart: now,
        dtend: now + 60 * 60_000,
        organizer: 'sage',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      })

      const ics = exportEventToIcs(event)
      expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR')
    })

    it('exports attendees with PARTSTAT', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Planning',
        dtstart: now,
        dtend: now + 60 * 60_000,
        organizer: 'kai',
        attendees: [
          { name: 'link', status: 'accepted' },
          { name: 'sage', status: 'declined', email: 'sage@example.com' },
          { name: 'pixel', status: 'tentative' },
        ],
      })

      const ics = exportEventToIcs(event)
      expect(ics).toContain('ATTENDEE;CN=link;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:link@reflectt.ai')
      expect(ics).toContain('ATTENDEE;CN=sage;PARTSTAT=DECLINED;RSVP=TRUE:mailto:sage@example.com')
      expect(ics).toContain('ATTENDEE;CN=pixel;PARTSTAT=TENTATIVE;RSVP=TRUE:mailto:pixel@reflectt.ai')
    })

    it('exports VALARM for reminders', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'With reminders',
        dtstart: now + 120 * 60_000,
        dtend: now + 180 * 60_000,
        organizer: 'link',
        reminders: [
          { minutes_before: 10, method: 'chat' },
          { minutes_before: 60, method: 'inbox' },
          { minutes_before: 1440, method: 'chat' },
        ],
      })

      const ics = exportEventToIcs(event)
      expect(ics).toContain('BEGIN:VALARM')
      expect(ics).toContain('TRIGGER:-PT10M')
      expect(ics).toContain('TRIGGER:-PT1H')
      expect(ics).toContain('TRIGGER:-P1D')
      expect(ics).toContain('ACTION:DISPLAY')
      // Count VALARM blocks
      const alarmCount = (ics.match(/BEGIN:VALARM/g) || []).length
      expect(alarmCount).toBe(3)
    })

    it('exports categories', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Tagged event',
        dtstart: now,
        dtend: now + 60 * 60_000,
        organizer: 'link',
        categories: ['meeting', 'sprint'],
      })

      const ics = exportEventToIcs(event)
      expect(ics).toContain('CATEGORIES:meeting,sprint')
    })

    it('exports multiple events', () => {
      const now = Date.now()
      calendarEvents.createEvent({ summary: 'Event 1', dtstart: now, dtend: now + 60_000, organizer: 'a' })
      calendarEvents.createEvent({ summary: 'Event 2', dtstart: now, dtend: now + 60_000, organizer: 'b' })

      const events = calendarEvents.listEvents()
      const ics = exportToIcs(events)

      const veventCount = (ics.match(/BEGIN:VEVENT/g) || []).length
      expect(veventCount).toBe(2)
      expect(ics).toContain('Event 1')
      expect(ics).toContain('Event 2')
    })

    it('escapes special characters', () => {
      const now = Date.now()
      const event = calendarEvents.createEvent({
        summary: 'Meeting; with, special\nchars',
        dtstart: now,
        dtend: now + 60 * 60_000,
        organizer: 'link',
      })

      const ics = exportEventToIcs(event)
      expect(ics).toContain('SUMMARY:Meeting\\; with\\, special\\nchars')
    })
  })

  describe('Parse', () => {
    it('parses a simple VEVENT', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:test-123@example.com',
        'SUMMARY:Test Event',
        'DESCRIPTION:A test',
        'DTSTART:20260301T100000Z',
        'DTEND:20260301T110000Z',
        'LOCATION:Conference Room',
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const events = parseIcs(ics)
      expect(events).toHaveLength(1)
      expect(events[0].uid).toBe('test-123@example.com')
      expect(events[0].summary).toBe('Test Event')
      expect(events[0].description).toBe('A test')
      expect(events[0].location).toBe('Conference Room')
      expect(events[0].status).toBe('confirmed')
      expect(events[0].dtstart).toBe(Date.UTC(2026, 2, 1, 10, 0, 0))
      expect(events[0].dtend).toBe(Date.UTC(2026, 2, 1, 11, 0, 0))
    })

    it('parses RRULE', () => {
      const ics = [
        'BEGIN:VEVENT',
        'UID:rrule-test@example.com',
        'SUMMARY:Recurring',
        'DTSTART:20260301T090000Z',
        'DTEND:20260301T100000Z',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
        'END:VEVENT',
      ].join('\r\n')

      const events = parseIcs(ics)
      expect(events[0].rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR')
    })

    it('parses ATTENDEE with CN and PARTSTAT', () => {
      const ics = [
        'BEGIN:VEVENT',
        'UID:attendee-test@example.com',
        'SUMMARY:Meeting',
        'DTSTART:20260301T090000Z',
        'DTEND:20260301T100000Z',
        'ATTENDEE;CN=Alice;PARTSTAT=ACCEPTED:mailto:alice@example.com',
        'ATTENDEE;CN=Bob;PARTSTAT=TENTATIVE:mailto:bob@example.com',
        'ATTENDEE;PARTSTAT=DECLINED:mailto:carol@example.com',
        'END:VEVENT',
      ].join('\r\n')

      const events = parseIcs(ics)
      expect(events[0].attendees).toHaveLength(3)
      expect(events[0].attendees[0]).toMatchObject({ name: 'Alice', status: 'accepted', email: 'alice@example.com' })
      expect(events[0].attendees[1]).toMatchObject({ name: 'Bob', status: 'tentative', email: 'bob@example.com' })
      expect(events[0].attendees[2]).toMatchObject({ name: 'carol', status: 'declined', email: 'carol@example.com' })
    })

    it('parses VALARM → reminders', () => {
      const ics = [
        'BEGIN:VEVENT',
        'UID:alarm-test@example.com',
        'SUMMARY:Alarmed Event',
        'DTSTART:20260301T090000Z',
        'DTEND:20260301T100000Z',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'TRIGGER:-PT15M',
        'DESCRIPTION:15 min reminder',
        'END:VALARM',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'TRIGGER:-PT1H',
        'END:VALARM',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'TRIGGER:-P1D',
        'END:VALARM',
        'END:VEVENT',
      ].join('\r\n')

      const events = parseIcs(ics)
      expect(events[0].reminders).toHaveLength(3)
      expect(events[0].reminders[0].minutes_before).toBe(15)
      expect(events[0].reminders[1].minutes_before).toBe(60)
      expect(events[0].reminders[2].minutes_before).toBe(1440)
    })

    it('parses ORGANIZER with CN', () => {
      const ics = [
        'BEGIN:VEVENT',
        'UID:org-test@example.com',
        'SUMMARY:Org Test',
        'DTSTART:20260301T090000Z',
        'DTEND:20260301T100000Z',
        'ORGANIZER;CN=Ryan Campbell:mailto:ryan@reflectt.ai',
        'END:VEVENT',
      ].join('\r\n')

      const events = parseIcs(ics)
      expect(events[0].organizer).toBe('Ryan Campbell')
    })

    it('parses CATEGORIES', () => {
      const ics = [
        'BEGIN:VEVENT',
        'UID:cat-test@example.com',
        'SUMMARY:Categorized',
        'DTSTART:20260301T090000Z',
        'DTEND:20260301T100000Z',
        'CATEGORIES:meeting,sprint,planning',
        'END:VEVENT',
      ].join('\r\n')

      const events = parseIcs(ics)
      expect(events[0].categories).toEqual(['meeting', 'sprint', 'planning'])
    })

    it('handles line folding (RFC 5545)', () => {
      const ics = [
        'BEGIN:VEVENT',
        'UID:fold-test@example.com',
        'SUMMARY:This is a very long event summary that needs to be folded across',
        ' multiple lines according to RFC 5545 rules',
        'DTSTART:20260301T090000Z',
        'DTEND:20260301T100000Z',
        'END:VEVENT',
      ].join('\r\n')

      const events = parseIcs(ics)
      expect(events[0].summary).toContain('very long event summary')
      expect(events[0].summary).toContain('RFC 5545 rules')
    })

    it('handles escaped characters', () => {
      const ics = [
        'BEGIN:VEVENT',
        'UID:escape-test@example.com',
        'SUMMARY:Meeting\\; with\\, special\\nchars',
        'DTSTART:20260301T090000Z',
        'DTEND:20260301T100000Z',
        'END:VEVENT',
      ].join('\r\n')

      const events = parseIcs(ics)
      expect(events[0].summary).toBe('Meeting; with, special\nchars')
    })

    it('handles multiple VEVENTs', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:multi-1@example.com',
        'SUMMARY:Event 1',
        'DTSTART:20260301T090000Z',
        'DTEND:20260301T100000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:multi-2@example.com',
        'SUMMARY:Event 2',
        'DTSTART:20260302T090000Z',
        'DTEND:20260302T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const events = parseIcs(ics)
      expect(events).toHaveLength(2)
      expect(events[0].summary).toBe('Event 1')
      expect(events[1].summary).toBe('Event 2')
    })
  })

  describe('Import', () => {
    it('imports events from ICS content', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:import-1@example.com',
        'SUMMARY:Imported Event',
        'DTSTART:20260301T100000Z',
        'DTEND:20260301T110000Z',
        'ORGANIZER;CN=Ryan:mailto:ryan@example.com',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const result = importFromIcs(ics)
      expect(result.created).toHaveLength(1)
      expect(result.errors).toHaveLength(0)
      expect(result.created[0].summary).toBe('Imported Event')
      expect(result.created[0].organizer).toBe('Ryan')

      // Verify it's in the database
      const events = calendarEvents.listEvents()
      expect(events.length).toBeGreaterThanOrEqual(1)
    })

    it('skips duplicates by UID', () => {
      const ics = [
        'BEGIN:VEVENT',
        'UID:dedup-test@example.com',
        'SUMMARY:First Import',
        'DTSTART:20260301T100000Z',
        'DTEND:20260301T110000Z',
        'ORGANIZER;CN=link:mailto:link@reflectt.ai',
        'END:VEVENT',
      ].join('\r\n')

      const result1 = importFromIcs(ics)
      expect(result1.created).toHaveLength(1)

      const result2 = importFromIcs(ics)
      expect(result2.created).toHaveLength(0)
      expect(result2.skipped).toBe(1)
    })

    it('reports errors for invalid events', () => {
      const ics = [
        'BEGIN:VEVENT',
        'UID:no-summary@example.com',
        'DTSTART:20260301T100000Z',
        'DTEND:20260301T110000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:no-dtstart@example.com',
        'SUMMARY:Missing start',
        'END:VEVENT',
      ].join('\r\n')

      const result = importFromIcs(ics)
      expect(result.created).toHaveLength(0)
      expect(result.errors).toHaveLength(2)
      expect(result.errors[0].error).toContain('SUMMARY')
      expect(result.errors[1].error).toContain('DTSTART')
    })

    it('defaults dtend to dtstart + 1 hour when missing', () => {
      const ics = [
        'BEGIN:VEVENT',
        'UID:no-end@example.com',
        'SUMMARY:No end time',
        'DTSTART:20260301T100000Z',
        'ORGANIZER;CN=link:mailto:link@reflectt.ai',
        'END:VEVENT',
      ].join('\r\n')

      const result = importFromIcs(ics)
      expect(result.created).toHaveLength(1)
      const event = result.created[0]
      expect(event.dtend - event.dtstart).toBe(60 * 60_000)
    })

    it('imports VALARM as reminders', () => {
      const ics = [
        'BEGIN:VEVENT',
        'UID:alarm-import@example.com',
        'SUMMARY:With Alarm',
        'DTSTART:20260301T100000Z',
        'DTEND:20260301T110000Z',
        'ORGANIZER;CN=link:mailto:link@reflectt.ai',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'TRIGGER:-PT30M',
        'END:VALARM',
        'END:VEVENT',
      ].join('\r\n')

      const result = importFromIcs(ics)
      expect(result.created).toHaveLength(1)
      expect(result.created[0].reminders).toHaveLength(1)
      expect(result.created[0].reminders[0].minutes_before).toBe(30)
    })

    it('imports attendees with status', () => {
      const ics = [
        'BEGIN:VEVENT',
        'UID:attendee-import@example.com',
        'SUMMARY:With Attendees',
        'DTSTART:20260301T100000Z',
        'DTEND:20260301T110000Z',
        'ORGANIZER;CN=kai:mailto:kai@reflectt.ai',
        'ATTENDEE;CN=link;PARTSTAT=ACCEPTED:mailto:link@reflectt.ai',
        'ATTENDEE;CN=sage;PARTSTAT=TENTATIVE:mailto:sage@reflectt.ai',
        'END:VEVENT',
      ].join('\r\n')

      const result = importFromIcs(ics)
      expect(result.created).toHaveLength(1)
      expect(result.created[0].attendees).toHaveLength(2)
      expect(result.created[0].attendees[0]).toMatchObject({ name: 'link', status: 'accepted' })
      expect(result.created[0].attendees[1]).toMatchObject({ name: 'sage', status: 'tentative' })
    })
  })

  describe('Round-trip', () => {
    it('RRULE round-trips through export then import', () => {
      const now = Date.now()
      const original = calendarEvents.createEvent({
        summary: 'Round-trip recurring',
        dtstart: now,
        dtend: now + 60 * 60_000,
        organizer: 'link',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
        attendees: [
          { name: 'sage', status: 'accepted' },
          { name: 'pixel', status: 'tentative' },
        ],
        reminders: [
          { minutes_before: 15, method: 'chat' },
          { minutes_before: 1440, method: 'inbox' },
        ],
        categories: ['standup', 'daily'],
      })

      // Export
      const ics = exportEventToIcs(original)

      // Delete original
      calendarEvents.deleteEvent(original.id)

      // Import back
      const result = importFromIcs(ics)
      expect(result.created).toHaveLength(1)

      const imported = result.created[0]
      expect(imported.summary).toBe('Round-trip recurring')
      expect(imported.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR')
      expect(imported.attendees).toHaveLength(2)
      expect(imported.attendees[0].name).toBe('sage')
      expect(imported.attendees[0].status).toBe('accepted')
      expect(imported.attendees[1].name).toBe('pixel')
      expect(imported.attendees[1].status).toBe('tentative')
      expect(imported.reminders).toHaveLength(2)
      expect(imported.reminders[0].minutes_before).toBe(15)
      expect(imported.reminders[1].minutes_before).toBe(1440)
      expect(imported.categories).toEqual(['standup', 'daily'])
    })

    it('simple event round-trips correctly', () => {
      const now = Date.now()
      const original = calendarEvents.createEvent({
        summary: 'Simple round-trip',
        description: 'Test description',
        dtstart: now,
        dtend: now + 30 * 60_000,
        organizer: 'link',
        location: 'https://meet.reflectt.ai',
      })

      const ics = exportEventToIcs(original)
      calendarEvents.deleteEvent(original.id)

      const result = importFromIcs(ics)
      expect(result.created).toHaveLength(1)

      const imported = result.created[0]
      expect(imported.summary).toBe('Simple round-trip')
      expect(imported.description).toBe('Test description')
      expect(imported.location).toBe('https://meet.reflectt.ai')
      expect(imported.organizer).toBe('link')
    })
  })
})
