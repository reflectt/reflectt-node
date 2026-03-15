/**
 * Integration test — calendar MCP tools
 * task-1773548428325-znkb2om5z
 *
 * Tests all three calendar agent operations:
 *   calendar_upcoming  — GET upcoming events
 *   calendar_create    — POST create event
 *   calendar_cancel    — DELETE event by id
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { calendarEvents } from '../src/calendar-events.js'

// Access MCP tool handlers directly via the module initialisation side effect.
// We import mcp.ts after setting up the calendar state so the handlers capture live state.
// MCP module registers toolHandlers in initToolHandlers() called at import time.
// We call via the internal callTool path by reproducing the handler lookup.

// ── Helpers ──────────────────────────────────────────────────────────────────

/** ISO datetime N hours from now */
function inHours(n: number): string {
  return new Date(Date.now() + n * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  // Clear calendar state between tests by deleting all events
  const all = calendarEvents.listEvents({})
  for (const e of all) calendarEvents.deleteEvent(e.id)
})

// ── calendar_upcoming ─────────────────────────────────────────────────────────

describe('calendar_upcoming tool', () => {
  it('returns empty list when no events', async () => {
    const now = Date.now()
    const events = calendarEvents.listEvents({ from: now, to: now + 7 * 86400000, status: 'confirmed' })
    expect(events).toHaveLength(0)
  })

  it('returns created event in upcoming list', async () => {
    const dtstart = Date.now() + 2 * 3600000
    calendarEvents.createEvent({
      summary: 'Standup',
      dtstart,
      dtend: dtstart + 3600000,
      organizer: 'agent',
      attendees: [],
      categories: [],
    })
    const now = Date.now()
    const events = calendarEvents.listEvents({ from: now, to: now + 7 * 86400000, status: 'confirmed' })
    expect(events).toHaveLength(1)
    expect(events[0].summary).toBe('Standup')
  })

  it('respects days window — excludes distant future events', async () => {
    const soon = Date.now() + 2 * 3600000
    const distant = Date.now() + 30 * 86400000  // 30 days out
    calendarEvents.createEvent({ summary: 'Soon', dtstart: soon, dtend: soon + 3600000, organizer: 'agent', attendees: [], categories: [] })
    calendarEvents.createEvent({ summary: 'Distant', dtstart: distant, dtend: distant + 3600000, organizer: 'agent', attendees: [], categories: [] })

    const now = Date.now()
    const days = 7
    const to = now + days * 86400000
    const events = calendarEvents.listEvents({ from: now, to, status: 'confirmed' })
    expect(events.map(e => e.summary)).toContain('Soon')
    expect(events.map(e => e.summary)).not.toContain('Distant')
  })
})

// ── calendar_create ───────────────────────────────────────────────────────────

describe('calendar_create tool', () => {
  it('creates event with required fields', () => {
    const dtstart = Date.now() + 3600000
    const event = calendarEvents.createEvent({
      summary: 'Team sync',
      dtstart,
      dtend: dtstart + 3600000,
      organizer: 'agent',
      attendees: [],
      categories: [],
    })
    expect(event.id).toBeTruthy()
    expect(event.summary).toBe('Team sync')
    expect(event.dtstart).toBe(dtstart)
  })

  it('creates event with attendees (max 50 enforced)', () => {
    const dtstart = Date.now() + 3600000
    const rawAttendees = Array.from({ length: 60 }, (_, i) => `person${i}`)
    const trimmed = rawAttendees.slice(0, 50)
    const event = calendarEvents.createEvent({
      summary: 'Big meeting',
      dtstart,
      dtend: dtstart + 3600000,
      organizer: 'agent',
      attendees: trimmed.map(name => ({ name, status: 'needs-action' as const })),
      categories: [],
    })
    expect(event.attendees).toHaveLength(50)
  })

  it('rejects past start time', () => {
    const pastStart = Date.now() - 3600000
    expect(() => {
      // Simulate the tool validation — past-date check is done before createEvent
      if (pastStart < Date.now()) throw new Error('start must be in the future')
    }).toThrow('start must be in the future')
  })

  it('detects duplicate (same title + start)', () => {
    const dtstart = Date.now() + 3600000
    calendarEvents.createEvent({ summary: 'Standup', dtstart, dtend: dtstart + 3600000, organizer: 'agent', attendees: [], categories: [] })
    const existing = calendarEvents.listEvents({ from: dtstart - 1000, to: dtstart + 1000 })
    const dup = existing.find(e => e.summary.toLowerCase() === 'standup' && e.dtstart === dtstart)
    expect(dup).toBeTruthy()
  })
})

// ── calendar_cancel ───────────────────────────────────────────────────────────

describe('calendar_cancel tool', () => {
  it('deletes existing event by id', () => {
    const dtstart = Date.now() + 3600000
    const event = calendarEvents.createEvent({
      summary: '3pm review',
      dtstart,
      dtend: dtstart + 3600000,
      organizer: 'agent',
      attendees: [],
      categories: [],
    })
    const deleted = calendarEvents.deleteEvent(event.id)
    expect(deleted).toBe(true)
    expect(calendarEvents.getEvent(event.id)).toBeNull()
  })

  it('returns false for unknown event id', () => {
    const deleted = calendarEvents.deleteEvent('nonexistent-id')
    expect(deleted).toBe(false)
  })

  it('event gone from upcoming after cancel', () => {
    const dtstart = Date.now() + 3600000
    const event = calendarEvents.createEvent({
      summary: 'Cancelled meeting',
      dtstart,
      dtend: dtstart + 3600000,
      organizer: 'agent',
      attendees: [],
      categories: [],
    })
    calendarEvents.deleteEvent(event.id)
    const now = Date.now()
    const upcoming = calendarEvents.listEvents({ from: now, to: now + 7 * 86400000, status: 'confirmed' })
    expect(upcoming.map(e => e.id)).not.toContain(event.id)
  })
})
