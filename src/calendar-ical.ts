// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * iCalendar (ICS) Import/Export
 *
 * Supports VCALENDAR with VEVENT, VALARM, ATTENDEE, RRULE.
 * RFC 5545 compliant for interop with Google Calendar, Apple Calendar, Outlook.
 */

import {
  calendarEvents,
  type CalendarEvent,
  type CreateEventInput,
  type Attendee,
  type Reminder,
  type AttendeeStatus,
} from './calendar-events.js'
import { getDb } from './db.js'

// ── Constants ──────────────────────────────────────────────────────────────

const CRLF = '\r\n'
const PRODID = '-//Reflectt AI//Calendar v1//EN'
const CALSCALE = 'GREGORIAN'
const VERSION = '2.0'

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * Format a Date as iCal DATETIME (UTC).
 * e.g., 20260225T150000Z
 */
function toICalDate(epochMs: number): string {
  const d = new Date(epochMs)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/**
 * Fold long lines per RFC 5545 (max 75 octets per line).
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = []
  parts.push(line.slice(0, 75))
  let pos = 75
  while (pos < line.length) {
    parts.push(' ' + line.slice(pos, pos + 74))
    pos += 74
  }
  return parts.join(CRLF)
}

/**
 * Escape text values per RFC 5545.
 */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * Map our AttendeeStatus to iCal PARTSTAT.
 */
function toPartStat(status: AttendeeStatus): string {
  switch (status) {
    case 'accepted': return 'ACCEPTED'
    case 'declined': return 'DECLINED'
    case 'tentative': return 'TENTATIVE'
    case 'needs-action': return 'NEEDS-ACTION'
    default: return 'NEEDS-ACTION'
  }
}

/**
 * Export a single CalendarEvent to VEVENT lines.
 */
function eventToVEvent(event: CalendarEvent): string[] {
  const lines: string[] = []
  lines.push('BEGIN:VEVENT')
  lines.push(`UID:${event.uid}`)
  lines.push(`DTSTAMP:${toICalDate(event.updated_at)}`)
  lines.push(`DTSTART:${toICalDate(event.dtstart)}`)
  lines.push(`DTEND:${toICalDate(event.dtend)}`)
  lines.push(`SUMMARY:${escapeText(event.summary)}`)

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`)
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeText(event.location)}`)
  }
  if (event.rrule) {
    lines.push(`RRULE:${event.rrule}`)
  }
  if (event.status) {
    lines.push(`STATUS:${event.status.toUpperCase()}`)
  }

  // Organizer
  lines.push(`ORGANIZER;CN=${escapeText(event.organizer)}:mailto:${event.organizer}@reflectt.ai`)

  // Attendees
  for (const attendee of event.attendees) {
    const email = attendee.email || `${attendee.name}@reflectt.ai`
    lines.push(`ATTENDEE;CN=${escapeText(attendee.name)};PARTSTAT=${toPartStat(attendee.status)};RSVP=TRUE:mailto:${email}`)
  }

  // Categories
  if (event.categories.length > 0) {
    lines.push(`CATEGORIES:${event.categories.map(escapeText).join(',')}`)
  }

  // Reminders → VALARM
  for (const reminder of event.reminders) {
    lines.push('BEGIN:VALARM')
    lines.push('ACTION:DISPLAY')
    lines.push(`DESCRIPTION:${escapeText(event.summary)} reminder`)

    // Convert minutes to iCal DURATION (negative = before)
    const duration = minutesToDuration(reminder.minutes_before)
    lines.push(`TRIGGER:${duration}`)
    lines.push('END:VALARM')
  }

  lines.push(`CREATED:${toICalDate(event.created_at)}`)
  lines.push(`LAST-MODIFIED:${toICalDate(event.updated_at)}`)
  lines.push('END:VEVENT')

  return lines
}

/**
 * Convert minutes to iCal DURATION format.
 * e.g., 10 → -PT10M, 60 → -PT1H, 1440 → -P1D
 */
function minutesToDuration(minutes: number): string {
  if (minutes <= 0) return '-PT0M'
  if (minutes % 1440 === 0) return `-P${minutes / 1440}D`
  if (minutes % 60 === 0) return `-PT${minutes / 60}H`
  return `-PT${minutes}M`
}

/**
 * Export events to a full iCalendar string (.ics content).
 */
export function exportToIcs(events: CalendarEvent[]): string {
  const lines: string[] = []
  lines.push('BEGIN:VCALENDAR')
  lines.push(`VERSION:${VERSION}`)
  lines.push(`PRODID:${PRODID}`)
  lines.push(`CALSCALE:${CALSCALE}`)
  lines.push('METHOD:PUBLISH')

  for (const event of events) {
    lines.push(...eventToVEvent(event))
  }

  lines.push('END:VCALENDAR')

  return lines.map(foldLine).join(CRLF) + CRLF
}

/**
 * Export a single event to ICS.
 */
export function exportEventToIcs(event: CalendarEvent): string {
  return exportToIcs([event])
}

// ── Import ─────────────────────────────────────────────────────────────────

/**
 * Parse an iCal DATETIME value to epoch ms.
 * Handles: 20260225T150000Z, 20260225T150000, 20260225
 */
function parseICalDate(value: string): number {
  const cleaned = value.replace(/[^0-9TZ]/g, '')

  if (cleaned.length >= 15) {
    // Full datetime: YYYYMMDDTHHmmss[Z]
    const year = parseInt(cleaned.slice(0, 4), 10)
    const month = parseInt(cleaned.slice(4, 6), 10) - 1
    const day = parseInt(cleaned.slice(6, 8), 10)
    const hour = parseInt(cleaned.slice(9, 11), 10)
    const min = parseInt(cleaned.slice(11, 13), 10)
    const sec = parseInt(cleaned.slice(13, 15), 10)

    if (cleaned.endsWith('Z')) {
      return Date.UTC(year, month, day, hour, min, sec)
    }
    return new Date(year, month, day, hour, min, sec).getTime()
  }

  if (cleaned.length >= 8) {
    // Date only: YYYYMMDD
    const year = parseInt(cleaned.slice(0, 4), 10)
    const month = parseInt(cleaned.slice(4, 6), 10) - 1
    const day = parseInt(cleaned.slice(6, 8), 10)
    return Date.UTC(year, month, day, 0, 0, 0)
  }

  return 0
}

/**
 * Parse iCal DURATION to minutes.
 * e.g., -PT10M → 10, -PT1H → 60, -P1D → 1440, PT30M → 30
 */
function parseDuration(value: string): number {
  const cleaned = value.replace(/^-/, '').trim()
  let minutes = 0

  // Days
  const dayMatch = cleaned.match(/(\d+)D/)
  if (dayMatch) minutes += parseInt(dayMatch[1], 10) * 1440

  // Hours
  const hourMatch = cleaned.match(/(\d+)H/)
  if (hourMatch) minutes += parseInt(hourMatch[1], 10) * 60

  // Minutes
  const minMatch = cleaned.match(/(\d+)M/)
  if (minMatch) minutes += parseInt(minMatch[1], 10)

  // Weeks
  const weekMatch = cleaned.match(/(\d+)W/)
  if (weekMatch) minutes += parseInt(weekMatch[1], 10) * 7 * 1440

  return minutes
}

/**
 * Map iCal PARTSTAT to our AttendeeStatus.
 */
function fromPartStat(partstat: string): AttendeeStatus {
  switch (partstat.toUpperCase()) {
    case 'ACCEPTED': return 'accepted'
    case 'DECLINED': return 'declined'
    case 'TENTATIVE': return 'tentative'
    default: return 'needs-action'
  }
}

/**
 * Extract a parameter value from an iCal property line.
 * e.g., extractParam('ATTENDEE;CN=Link;PARTSTAT=ACCEPTED:mailto:link@x.com', 'CN') → 'Link'
 */
function extractParam(line: string, param: string): string | null {
  const paramRegex = new RegExp(`${param}=([^;:]+)`, 'i')
  const match = line.match(paramRegex)
  return match ? match[1] : null
}

/**
 * Unfold lines per RFC 5545 (lines starting with space/tab are continuations).
 */
function unfoldLines(raw: string): string[] {
  // Normalize line endings
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rawLines = normalized.split('\n')
  const lines: string[] = []

  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      // Continuation — append to previous line (strip leading whitespace)
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }

  return lines.filter(l => l.length > 0)
}

/**
 * Get the value part of a property line (after the first : that isn't in params).
 */
function getPropertyValue(line: string): string {
  // Find the first colon that separates property name/params from value
  const colonIdx = line.indexOf(':')
  if (colonIdx < 0) return ''
  return line.slice(colonIdx + 1)
}

/**
 * Get the property name (before params and value).
 */
function getPropertyName(line: string): string {
  const colonIdx = line.indexOf(':')
  const semiIdx = line.indexOf(';')
  if (semiIdx >= 0 && (colonIdx < 0 || semiIdx < colonIdx)) {
    return line.slice(0, semiIdx).toUpperCase()
  }
  if (colonIdx >= 0) {
    return line.slice(0, colonIdx).toUpperCase()
  }
  return line.toUpperCase()
}

interface ParsedVEvent {
  uid?: string
  summary?: string
  description?: string
  dtstart?: number
  dtend?: number
  rrule?: string
  location?: string
  organizer?: string
  status?: string
  attendees: Attendee[]
  reminders: Reminder[]
  categories: string[]
}

/**
 * Parse a .ics string and extract VEVENT components.
 */
export function parseIcs(icsContent: string): ParsedVEvent[] {
  const lines = unfoldLines(icsContent)
  const events: ParsedVEvent[] = []
  let current: ParsedVEvent | null = null
  let inAlarm = false

  for (const line of lines) {
    const propName = getPropertyName(line)
    const propValue = getPropertyValue(line)

    if (propName === 'BEGIN' && propValue === 'VEVENT') {
      current = { attendees: [], reminders: [], categories: [] }
      inAlarm = false
      continue
    }

    if (propName === 'END' && propValue === 'VEVENT') {
      if (current) events.push(current)
      current = null
      continue
    }

    if (propName === 'BEGIN' && propValue === 'VALARM') {
      inAlarm = true
      continue
    }

    if (propName === 'END' && propValue === 'VALARM') {
      inAlarm = false
      continue
    }

    if (!current) continue

    // Inside VALARM
    if (inAlarm) {
      if (propName === 'TRIGGER') {
        const minutes = parseDuration(propValue)
        if (minutes > 0) {
          current.reminders.push({ minutes_before: minutes, method: 'chat' })
        }
      }
      continue
    }

    // Inside VEVENT (not in VALARM)
    switch (propName) {
      case 'UID':
        current.uid = propValue
        break
      case 'SUMMARY':
        current.summary = unescapeText(propValue)
        break
      case 'DESCRIPTION':
        current.description = unescapeText(propValue)
        break
      case 'DTSTART':
        current.dtstart = parseICalDate(propValue)
        break
      case 'DTEND':
        current.dtend = parseICalDate(propValue)
        break
      case 'RRULE':
        current.rrule = propValue
        break
      case 'LOCATION':
        current.location = unescapeText(propValue)
        break
      case 'STATUS':
        current.status = propValue.toLowerCase()
        break
      case 'ORGANIZER': {
        // Try CN param first, fall back to mailto value
        const cn = extractParam(line, 'CN')
        if (cn) {
          current.organizer = unescapeText(cn)
        } else {
          // Extract from mailto:
          const mailto = propValue.replace(/^mailto:/i, '')
          current.organizer = mailto.split('@')[0] || mailto
        }
        break
      }
      case 'ATTENDEE': {
        const cn = extractParam(line, 'CN')
        const partstat = extractParam(line, 'PARTSTAT')
        const mailto = propValue.replace(/^mailto:/i, '')
        const name = cn ? unescapeText(cn) : mailto.split('@')[0] || mailto
        const email = mailto.includes('@') ? mailto : undefined

        current.attendees.push({
          name,
          email,
          status: partstat ? fromPartStat(partstat) : 'needs-action',
        })
        break
      }
      case 'CATEGORIES': {
        const cats = propValue.split(',').map(c => unescapeText(c.trim())).filter(Boolean)
        current.categories.push(...cats)
        break
      }
    }
  }

  return events
}

/**
 * Unescape iCal text values.
 */
function unescapeText(text: string): string {
  return text
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/**
 * Overwrite the UID of an event (for preserving original UIDs on import).
 */
function overwriteEventUid(eventId: string, uid: string): void {
  const db = getDb()
  db.prepare('UPDATE calendar_events SET uid = ? WHERE id = ?').run(uid, eventId)
}

/**
 * Import events from a .ics string into the calendar.
 * Returns created events and any errors.
 */
export function importFromIcs(icsContent: string, defaultOrganizer = 'system'): {
  created: CalendarEvent[]
  errors: Array<{ index: number; error: string; event?: Partial<ParsedVEvent> }>
  skipped: number
} {
  const parsed = parseIcs(icsContent)
  const created: CalendarEvent[] = []
  const errors: Array<{ index: number; error: string; event?: Partial<ParsedVEvent> }> = []
  let skipped = 0

  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i]

    // Check for duplicate by UID
    if (p.uid) {
      const existing = calendarEvents.getEventByUid(p.uid)
      if (existing) {
        skipped++
        continue
      }
    }

    if (!p.summary) {
      errors.push({ index: i, error: 'Missing SUMMARY', event: { uid: p.uid } })
      continue
    }
    if (!p.dtstart) {
      errors.push({ index: i, error: 'Missing DTSTART', event: { uid: p.uid, summary: p.summary } })
      continue
    }

    // Default dtend to dtstart + 1 hour if missing
    const dtend = p.dtend || (p.dtstart + 60 * 60 * 1000)

    const input: CreateEventInput = {
      summary: p.summary,
      description: p.description,
      dtstart: p.dtstart,
      dtend: dtend,
      rrule: p.rrule || undefined,
      organizer: p.organizer || defaultOrganizer,
      attendees: p.attendees,
      location: p.location,
      categories: p.categories,
      reminders: p.reminders,
      status: (p.status as any) || 'confirmed',
    }

    try {
      const event = calendarEvents.createEvent(input)

      // Preserve original UID for dedup on re-import
      if (p.uid && event.uid !== p.uid) {
        overwriteEventUid(event.id, p.uid)
        event.uid = p.uid
      }

      created.push(event)
    } catch (err: any) {
      errors.push({ index: i, error: err.message, event: { uid: p.uid, summary: p.summary } })
    }
  }

  return { created, errors, skipped }
}
