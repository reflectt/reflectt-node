// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Calendar Events — Full event system with iCal-aligned fields
 *
 * Real calendar events with participants, reminders, recurrence (RRULE),
 * and RSVP. Uses RFC 5545 field naming for natural iCal import/export.
 */

import { getDb } from './db.js'
import { eventBus } from './events.js'

// ── Types ──────────────────────────────────────────────────────────────────

export type EventStatus = 'confirmed' | 'tentative' | 'cancelled'
export type AttendeeStatus = 'accepted' | 'declined' | 'tentative' | 'needs-action'
export type ReminderMethod = 'chat' | 'inbox'

export interface Attendee {
  name: string          // agent name or human name
  email?: string        // for humans / external
  status: AttendeeStatus
  rsvp_at?: number      // when they responded
}

export interface Reminder {
  minutes_before: number
  method: ReminderMethod
}

export interface CalendarEvent {
  id: string
  uid: string             // RFC 5545 UID for interop
  summary: string         // title
  description: string
  dtstart: number         // epoch ms
  dtend: number           // epoch ms
  timezone: string        // IANA timezone
  rrule: string | null    // RFC 5545 RRULE string (e.g., "FREQ=WEEKLY;BYDAY=MO,WE,FR")
  organizer: string       // agent name or human name
  attendees: Attendee[]
  location: string        // text or URL
  categories: string[]    // tags
  reminders: Reminder[]
  status: EventStatus
  created_at: number
  updated_at: number
}

export interface CreateEventInput {
  summary: string
  description?: string
  dtstart: number
  dtend: number
  timezone?: string
  rrule?: string | null
  organizer: string
  attendees?: Attendee[]
  location?: string
  categories?: string[]
  reminders?: Reminder[]
  status?: EventStatus
}

export interface UpdateEventInput {
  summary?: string
  description?: string
  dtstart?: number
  dtend?: number
  timezone?: string
  rrule?: string | null
  organizer?: string
  attendees?: Attendee[]
  location?: string
  categories?: string[]
  reminders?: Reminder[]
  status?: EventStatus
}

// ── Constants ──────────────────────────────────────────────────────────────

const VALID_STATUSES: EventStatus[] = ['confirmed', 'tentative', 'cancelled']
const VALID_ATTENDEE_STATUSES: AttendeeStatus[] = ['accepted', 'declined', 'tentative', 'needs-action']
const VALID_REMINDER_METHODS: ReminderMethod[] = ['chat', 'inbox']

// RRULE frequency values we support
const VALID_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']

// ── Database setup ─────────────────────────────────────────────────────────

let initialized = false

function ensureTable(): void {
  if (initialized) return
  const db = getDb()

  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      dtstart INTEGER NOT NULL,
      dtend INTEGER NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      rrule TEXT,
      organizer TEXT NOT NULL,
      attendees_json TEXT NOT NULL DEFAULT '[]',
      location TEXT NOT NULL DEFAULT '',
      categories_json TEXT NOT NULL DEFAULT '[]',
      reminders_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'tentative', 'cancelled')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_organizer ON calendar_events(organizer)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_dtstart ON calendar_events(dtstart)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_status ON calendar_events(status)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_uid ON calendar_events(uid)`)

  // Fired reminders tracking (survives restarts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_fired_reminders (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      occurrence_start INTEGER NOT NULL,
      minutes_before INTEGER NOT NULL,
      fired_at INTEGER NOT NULL,
      delivered_to TEXT NOT NULL DEFAULT '[]',
      UNIQUE(event_id, occurrence_start, minutes_before)
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fired_event ON calendar_fired_reminders(event_id)`)

  initialized = true
}

// ── ID / UID generation ────────────────────────────────────────────────────

function generateId(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 10)
  return `evt-${ts}-${rand}`
}

function generateUid(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 12)
  return `${ts}-${rand}@reflectt.ai`
}

// ── RRULE parsing ──────────────────────────────────────────────────────────

export interface ParsedRRule {
  freq: string
  interval: number
  byday?: string[]
  bymonthday?: number[]
  bymonth?: number[]
  count?: number
  until?: number   // epoch ms
}

export function parseRRule(rrule: string): ParsedRRule {
  const parts = rrule.split(';')
  const result: ParsedRRule = { freq: '', interval: 1 }

  for (const part of parts) {
    const [key, value] = part.split('=')
    switch (key.toUpperCase()) {
      case 'FREQ':
        if (!VALID_FREQUENCIES.includes(value.toUpperCase())) {
          throw new Error(`Invalid RRULE frequency: ${value}`)
        }
        result.freq = value.toUpperCase()
        break
      case 'INTERVAL':
        result.interval = parseInt(value, 10)
        break
      case 'BYDAY':
        result.byday = value.split(',').map(d => d.trim().toUpperCase())
        break
      case 'BYMONTHDAY':
        result.bymonthday = value.split(',').map(d => parseInt(d.trim(), 10))
        break
      case 'BYMONTH':
        result.bymonth = value.split(',').map(d => parseInt(d.trim(), 10))
        break
      case 'COUNT':
        result.count = parseInt(value, 10)
        break
      case 'UNTIL': {
        // Parse iCal date format (YYYYMMDDTHHMMSSZ or YYYYMMDD)
        const cleaned = value.replace(/[TZ:-]/g, '')
        if (cleaned.length >= 8) {
          const year = parseInt(cleaned.slice(0, 4), 10)
          const month = parseInt(cleaned.slice(4, 6), 10) - 1
          const day = parseInt(cleaned.slice(6, 8), 10)
          const hour = cleaned.length >= 10 ? parseInt(cleaned.slice(8, 10), 10) : 23
          const min = cleaned.length >= 12 ? parseInt(cleaned.slice(10, 12), 10) : 59
          result.until = new Date(Date.UTC(year, month, day, hour, min)).getTime()
        }
        break
      }
    }
  }

  if (!result.freq) {
    throw new Error('RRULE must contain FREQ')
  }

  return result
}

/**
 * Get upcoming occurrences of a recurring event within a time window.
 */
export function getOccurrences(event: CalendarEvent, from: number, to: number, maxOccurrences = 50): number[] {
  if (!event.rrule) {
    // One-off event — just check if it falls in range
    if (event.dtstart < to && event.dtend > from) {
      return [event.dtstart]
    }
    return []
  }

  const parsed = parseRRule(event.rrule)
  const occurrences: number[] = []
  const duration = event.dtend - event.dtstart
  const DAY_MS = 86400000
  const WEEK_MS = 7 * DAY_MS

  // Day name mapping for BYDAY
  const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

  let cursor = event.dtstart
  let count = 0
  const maxIterations = 1000 // safety limit

  for (let iter = 0; iter < maxIterations && cursor <= to; iter++) {
    if (parsed.until && cursor > parsed.until) break
    if (parsed.count && count >= parsed.count) break

    const cursorDate = new Date(cursor)

    let matches = true

    // Check BYDAY filter
    if (parsed.byday && parsed.freq === 'WEEKLY') {
      const dayName = DAY_NAMES[cursorDate.getUTCDay()]
      matches = parsed.byday.includes(dayName)
    }

    // Check BYMONTHDAY filter
    if (parsed.bymonthday && matches) {
      matches = parsed.bymonthday.includes(cursorDate.getUTCDate())
    }

    // Check BYMONTH filter
    if (parsed.bymonth && matches) {
      matches = parsed.bymonth.includes(cursorDate.getUTCMonth() + 1)
    }

    if (matches && cursor + duration > from && cursor < to) {
      occurrences.push(cursor)
      if (occurrences.length >= maxOccurrences) break
    }

    if (matches) count++

    // Advance cursor based on frequency
    switch (parsed.freq) {
      case 'DAILY':
        cursor += DAY_MS * parsed.interval
        break
      case 'WEEKLY':
        if (parsed.byday) {
          // Move to next day (we iterate day by day when BYDAY is present)
          cursor += DAY_MS
        } else {
          cursor += WEEK_MS * parsed.interval
        }
        break
      case 'MONTHLY': {
        const d = new Date(cursor)
        d.setUTCMonth(d.getUTCMonth() + parsed.interval)
        cursor = d.getTime()
        break
      }
      case 'YEARLY': {
        const d2 = new Date(cursor)
        d2.setUTCFullYear(d2.getUTCFullYear() + parsed.interval)
        cursor = d2.getTime()
        break
      }
      default:
        cursor += DAY_MS
    }
  }

  return occurrences
}

// ── Validation ─────────────────────────────────────────────────────────────

function validateEventInput(input: CreateEventInput): string[] {
  const errors: string[] = []

  if (!input.summary || typeof input.summary !== 'string' || input.summary.trim() === '') {
    errors.push('summary is required')
  }
  if (typeof input.dtstart !== 'number' || isNaN(input.dtstart)) {
    errors.push('dtstart must be a number (epoch ms)')
  }
  if (typeof input.dtend !== 'number' || isNaN(input.dtend)) {
    errors.push('dtend must be a number (epoch ms)')
  }
  if (input.dtend <= input.dtstart && !input.rrule) {
    errors.push('dtend must be after dtstart')
  }
  if (!input.organizer || typeof input.organizer !== 'string' || input.organizer.trim() === '') {
    errors.push('organizer is required')
  }
  if (input.status && !VALID_STATUSES.includes(input.status)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`)
  }
  if (input.rrule) {
    try {
      parseRRule(input.rrule)
    } catch (err: any) {
      errors.push(`Invalid rrule: ${err.message}`)
    }
  }
  if (input.attendees) {
    for (let i = 0; i < input.attendees.length; i++) {
      const a = input.attendees[i]
      if (!a.name || typeof a.name !== 'string') {
        errors.push(`attendees[${i}].name is required`)
      }
      if (a.status && !VALID_ATTENDEE_STATUSES.includes(a.status)) {
        errors.push(`attendees[${i}].status must be one of: ${VALID_ATTENDEE_STATUSES.join(', ')}`)
      }
    }
  }
  if (input.reminders) {
    for (let i = 0; i < input.reminders.length; i++) {
      const r = input.reminders[i]
      if (typeof r.minutes_before !== 'number' || r.minutes_before < 0) {
        errors.push(`reminders[${i}].minutes_before must be a non-negative number`)
      }
      if (r.method && !VALID_REMINDER_METHODS.includes(r.method)) {
        errors.push(`reminders[${i}].method must be one of: ${VALID_REMINDER_METHODS.join(', ')}`)
      }
    }
  }

  return errors
}

// ── Row conversion ─────────────────────────────────────────────────────────

interface EventRow {
  id: string
  uid: string
  summary: string
  description: string
  dtstart: number
  dtend: number
  timezone: string
  rrule: string | null
  organizer: string
  attendees_json: string
  location: string
  categories_json: string
  reminders_json: string
  status: EventStatus
  created_at: number
  updated_at: number
}

function rowToEvent(row: EventRow): CalendarEvent {
  return {
    id: row.id,
    uid: row.uid,
    summary: row.summary,
    description: row.description,
    dtstart: row.dtstart,
    dtend: row.dtend,
    timezone: row.timezone,
    rrule: row.rrule,
    organizer: row.organizer,
    attendees: JSON.parse(row.attendees_json || '[]'),
    location: row.location,
    categories: JSON.parse(row.categories_json || '[]'),
    reminders: JSON.parse(row.reminders_json || '[]'),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export function createEvent(input: CreateEventInput): CalendarEvent {
  ensureTable()
  const errors = validateEventInput(input)
  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join('; ')}`)
  }

  const db = getDb()
  const now = Date.now()
  const id = generateId()
  const uid = generateUid()

  const attendees = (input.attendees || []).map(a => ({
    ...a,
    status: a.status || 'needs-action',
  }))

  const reminders = (input.reminders || []).map(r => ({
    minutes_before: r.minutes_before,
    method: r.method || 'chat',
  }))

  db.prepare(`
    INSERT INTO calendar_events (id, uid, summary, description, dtstart, dtend, timezone, rrule, organizer, attendees_json, location, categories_json, reminders_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, uid,
    input.summary.trim(),
    (input.description || '').trim(),
    input.dtstart, input.dtend,
    input.timezone || 'UTC',
    input.rrule || null,
    input.organizer.trim(),
    JSON.stringify(attendees),
    (input.location || '').trim(),
    JSON.stringify(input.categories || []),
    JSON.stringify(reminders),
    input.status || 'confirmed',
    now, now,
  )

  const event = getEvent(id)!

  eventBus.emit({
    id: `evt-cal-${id}`,
    type: 'task_created' as any, // TODO: add calendar_event_created event type
    timestamp: now,
    data: { kind: 'calendar:event_created', eventId: id, summary: input.summary, organizer: input.organizer },
  })

  return event
}

export function getEvent(id: string): CalendarEvent | null {
  ensureTable()
  const db = getDb()
  const row = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as EventRow | undefined
  return row ? rowToEvent(row) : null
}

export function getEventByUid(uid: string): CalendarEvent | null {
  ensureTable()
  const db = getDb()
  const row = db.prepare('SELECT * FROM calendar_events WHERE uid = ?').get(uid) as EventRow | undefined
  return row ? rowToEvent(row) : null
}

export function listEvents(filters?: {
  organizer?: string
  attendee?: string      // filter events where this name is in attendees
  status?: EventStatus
  from?: number          // epoch ms
  to?: number            // epoch ms
  categories?: string[]
  limit?: number
}): CalendarEvent[] {
  ensureTable()
  const db = getDb()
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters?.organizer) {
    conditions.push('organizer = ?')
    params.push(filters.organizer)
  }
  if (filters?.status) {
    conditions.push('status = ?')
    params.push(filters.status)
  }
  // For time range: include events that overlap OR are recurring
  if (filters?.from || filters?.to) {
    const timeParts: string[] = []
    if (filters.from && filters.to) {
      timeParts.push('(rrule IS NOT NULL) OR (dtend > ? AND dtstart < ?)')
      params.push(filters.from, filters.to)
    } else if (filters.from) {
      timeParts.push('(rrule IS NOT NULL) OR (dtend > ?)')
      params.push(filters.from)
    } else if (filters.to) {
      timeParts.push('(rrule IS NOT NULL) OR (dtstart < ?)')
      params.push(filters.to)
    }
    if (timeParts.length > 0) {
      conditions.push(`(${timeParts.join(' AND ')})`)
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filters?.limit || 100
  let events = db.prepare(`SELECT * FROM calendar_events ${where} ORDER BY dtstart ASC LIMIT ?`).all(...params, limit) as EventRow[]

  let result = events.map(rowToEvent)

  // Post-filter: attendee name (can't do in SQL efficiently with JSON)
  if (filters?.attendee) {
    const name = filters.attendee.toLowerCase()
    result = result.filter(e =>
      e.organizer.toLowerCase() === name ||
      e.attendees.some(a => a.name.toLowerCase() === name)
    )
  }

  // Post-filter: categories
  if (filters?.categories && filters.categories.length > 0) {
    const cats = new Set(filters.categories.map(c => c.toLowerCase()))
    result = result.filter(e =>
      e.categories.some(c => cats.has(c.toLowerCase()))
    )
  }

  return result
}

export function updateEvent(id: string, input: UpdateEventInput): CalendarEvent | null {
  ensureTable()
  const db = getDb()
  const existing = getEvent(id)
  if (!existing) return null

  const updates: string[] = []
  const params: unknown[] = []

  if (input.summary !== undefined) {
    updates.push('summary = ?')
    params.push(input.summary.trim())
  }
  if (input.description !== undefined) {
    updates.push('description = ?')
    params.push(input.description.trim())
  }
  if (input.dtstart !== undefined) {
    updates.push('dtstart = ?')
    params.push(input.dtstart)
  }
  if (input.dtend !== undefined) {
    updates.push('dtend = ?')
    params.push(input.dtend)
  }
  if (input.timezone !== undefined) {
    updates.push('timezone = ?')
    params.push(input.timezone)
  }
  if (input.rrule !== undefined) {
    if (input.rrule) {
      parseRRule(input.rrule) // validate
    }
    updates.push('rrule = ?')
    params.push(input.rrule || null)
  }
  if (input.organizer !== undefined) {
    updates.push('organizer = ?')
    params.push(input.organizer.trim())
  }
  if (input.attendees !== undefined) {
    updates.push('attendees_json = ?')
    params.push(JSON.stringify(input.attendees))
  }
  if (input.location !== undefined) {
    updates.push('location = ?')
    params.push(input.location.trim())
  }
  if (input.categories !== undefined) {
    updates.push('categories_json = ?')
    params.push(JSON.stringify(input.categories))
  }
  if (input.reminders !== undefined) {
    updates.push('reminders_json = ?')
    params.push(JSON.stringify(input.reminders))
  }
  if (input.status !== undefined) {
    if (!VALID_STATUSES.includes(input.status)) {
      throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`)
    }
    updates.push('status = ?')
    params.push(input.status)
  }

  if (updates.length === 0) return existing

  const now = Date.now()
  updates.push('updated_at = ?')
  params.push(now)
  params.push(id)

  db.prepare(`UPDATE calendar_events SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  return getEvent(id)
}

export function deleteEvent(id: string): boolean {
  ensureTable()
  const db = getDb()
  // Also clean up fired reminders
  db.prepare('DELETE FROM calendar_fired_reminders WHERE event_id = ?').run(id)
  const result = db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id)
  return (result as any).changes > 0
}

// ── RSVP ───────────────────────────────────────────────────────────────────

export function rsvpEvent(eventId: string, attendeeName: string, status: AttendeeStatus): CalendarEvent | null {
  ensureTable()
  const event = getEvent(eventId)
  if (!event) return null

  if (!VALID_ATTENDEE_STATUSES.includes(status)) {
    throw new Error(`status must be one of: ${VALID_ATTENDEE_STATUSES.join(', ')}`)
  }

  const now = Date.now()
  const attendees = [...event.attendees]
  const existing = attendees.find(a => a.name.toLowerCase() === attendeeName.toLowerCase())

  if (existing) {
    existing.status = status
    existing.rsvp_at = now
  } else {
    // Add as new attendee with RSVP
    attendees.push({ name: attendeeName, status, rsvp_at: now })
  }

  const db = getDb()
  db.prepare('UPDATE calendar_events SET attendees_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(attendees), now, eventId)

  return getEvent(eventId)
}

// ── Reminders ──────────────────────────────────────────────────────────────

interface FiredReminderRow {
  id: string
  event_id: string
  occurrence_start: number
  minutes_before: number
  fired_at: number
  delivered_to: string
}

/**
 * Check if a reminder has already been fired for a specific event occurrence.
 */
function hasReminderFired(eventId: string, occurrenceStart: number, minutesBefore: number): boolean {
  ensureTable()
  const db = getDb()
  const row = db.prepare(
    'SELECT 1 FROM calendar_fired_reminders WHERE event_id = ? AND occurrence_start = ? AND minutes_before = ?'
  ).get(eventId, occurrenceStart, minutesBefore)
  return !!row
}

/**
 * Record that a reminder was fired.
 */
function recordFiredReminder(eventId: string, occurrenceStart: number, minutesBefore: number, deliveredTo: string[]): void {
  ensureTable()
  const db = getDb()
  const id = `fr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  db.prepare(
    'INSERT OR IGNORE INTO calendar_fired_reminders (id, event_id, occurrence_start, minutes_before, fired_at, delivered_to) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, eventId, occurrenceStart, minutesBefore, Date.now(), JSON.stringify(deliveredTo))
}

export interface PendingReminder {
  event: CalendarEvent
  occurrence_start: number
  minutes_before: number
  deliver_to: string[]   // agent/human names
  method: ReminderMethod
}

/**
 * Get all reminders that should fire right now.
 * Checks upcoming events within the next 24h window and returns
 * reminders that haven't been fired yet.
 */
export function getPendingReminders(atMs?: number): PendingReminder[] {
  const now = atMs || Date.now()
  const window = 24 * 60 * 60 * 1000 // look ahead 24h
  const events = listEvents({ from: now, to: now + window, status: 'confirmed' })
  const pending: PendingReminder[] = []

  for (const event of events) {
    if (event.reminders.length === 0) continue

    // Get occurrences in our window
    const occurrences = getOccurrences(event, now, now + window)

    for (const occStart of occurrences) {
      for (const reminder of event.reminders) {
        const fireAt = occStart - reminder.minutes_before * 60 * 1000

        // Should fire if: fire time is in the past (or now) but not too far in the past (>10 min grace)
        if (fireAt <= now && fireAt >= now - 10 * 60 * 1000) {
          if (!hasReminderFired(event.id, occStart, reminder.minutes_before)) {
            const deliverTo = [
              event.organizer,
              ...event.attendees
                .filter(a => a.status !== 'declined')
                .map(a => a.name),
            ]
            // Dedupe
            const unique = [...new Set(deliverTo.map(n => n.toLowerCase()))].map(lower =>
              deliverTo.find(n => n.toLowerCase() === lower)!
            )

            pending.push({
              event,
              occurrence_start: occStart,
              minutes_before: reminder.minutes_before,
              deliver_to: unique,
              method: reminder.method,
            })
          }
        }
      }
    }
  }

  return pending
}

/**
 * Mark a reminder as fired.
 */
export function markReminderFired(eventId: string, occurrenceStart: number, minutesBefore: number, deliveredTo: string[]): void {
  recordFiredReminder(eventId, occurrenceStart, minutesBefore, deliveredTo)
}

// ── Availability integration ───────────────────────────────────────────────

/**
 * Check if an agent has an event right now (for busy/free calculation).
 */
export function getAgentCurrentEvent(agent: string, atMs?: number): CalendarEvent | null {
  const now = atMs || Date.now()
  const events = listEvents({ attendee: agent, status: 'confirmed', from: now, to: now + 1 })

  for (const event of events) {
    const occurrences = getOccurrences(event, now, now + 1)
    if (occurrences.length > 0) {
      // Check if any occurrence is active right now
      const duration = event.dtend - event.dtstart
      for (const occ of occurrences) {
        if (occ <= now && occ + duration > now) {
          return event
        }
      }
    }
  }

  // Also check as organizer
  const organized = listEvents({ organizer: agent, status: 'confirmed', from: now, to: now + 1 })
  for (const event of organized) {
    const occurrences = getOccurrences(event, now, now + 1)
    if (occurrences.length > 0) {
      const duration = event.dtend - event.dtstart
      for (const occ of occurrences) {
        if (occ <= now && occ + duration > now) {
          return event
        }
      }
    }
  }

  return null
}

/**
 * Get next upcoming event for an agent.
 */
export function getAgentNextEvent(agent: string, atMs?: number): { event: CalendarEvent; starts_at: number } | null {
  const now = atMs || Date.now()
  const window = 7 * 24 * 60 * 60 * 1000 // look ahead 7 days
  const events = listEvents({ attendee: agent, status: 'confirmed', from: now, to: now + window })

  let earliest: { event: CalendarEvent; starts_at: number } | null = null

  for (const event of events) {
    const occurrences = getOccurrences(event, now, now + window, 5)
    for (const occ of occurrences) {
      if (occ > now && (!earliest || occ < earliest.starts_at)) {
        earliest = { event, starts_at: occ }
      }
    }
  }

  // Also check organized events
  const organized = listEvents({ organizer: agent, status: 'confirmed', from: now, to: now + window })
  for (const event of organized) {
    const occurrences = getOccurrences(event, now, now + window, 5)
    for (const occ of occurrences) {
      if (occ > now && (!earliest || occ < earliest.starts_at)) {
        earliest = { event, starts_at: occ }
      }
    }
  }

  return earliest
}

// ── Export singleton ───────────────────────────────────────────────────────

export const calendarEvents = {
  createEvent,
  getEvent,
  getEventByUid,
  listEvents,
  updateEvent,
  deleteEvent,
  rsvpEvent,
  getPendingReminders,
  markReminderFired,
  getAgentCurrentEvent,
  getAgentNextEvent,
  getOccurrences,
  parseRRule,
}
