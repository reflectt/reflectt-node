// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * iCalendar (ICS) Import/Export — RFC 5545 compliant
 *
 * Export events as .ics files, import .ics files into the calendar.
 * Handles VEVENT, VTIMEZONE (basic), VALARM → reminders, ATTENDEE → attendees.
 */

import { calendarEvents, type CalendarEvent, type CreateEventInput, type Attendee, type Reminder } from './calendar-events.js'

// ── ICS Generation ─────────────────────────────────────────────────────────

/**
 * Format a Date as iCal datetime string (YYYYMMDDTHHMMSSZ)
 */
function toICalDate(epochMs: number): string {
  const d = new Date(epochMs)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/**
 * Fold long lines per RFC 5545 (max 75 octets per line)
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = []
  parts.push(line.slice(0, 75))
  let remaining = line.slice(75)
  while (remaining.length > 0) {
    parts.push(' ' + remaining.slice(0, 74))
    remaining = remaining.slice(74)
  }
  return parts.join('\r\n')
}

/**
 * Escape text values per RFC 5545
 */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * Export a single event as a VEVENT string
 */
function eventToVEvent(event: CalendarEvent): string {
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

  lines.push(`ORGANIZER;CN=${escapeText(event.organizer)}:mailto:${event.organizer}@reflectt.ai`)

  for (const attendee of event.attendees) {
    const partstat = attendee.status === 'needs-action' ? 'NEEDS-ACTION'
      : attendee.status === 'accepted' ? 'ACCEPTED'
      : attendee.status === 'declined' ? 'DECLINED'
      : 'TENTATIVE'
    const email = attendee.email || `${attendee.name}@reflectt.ai`
    lines.push(`ATTENDEE;CN=${escapeText(attendee.name)};PARTSTAT=${partstat}:mailto:${email}`)
  }

  if (event.categories.length > 0) {
    lines.push(`CATEGORIES:${event.categories.map(escapeText).join(',')}`)
  }

  // VALARM for each reminder
  for (const reminder of event.reminders) {
    lines.push('BEGIN:VALARM')
    lines.push('ACTION:DISPLAY')
    lines.push(`DESCRIPTION:Reminder: ${escapeText(event.summary)}`)
    lines.push(`TRIGGER:-PT${reminder.minutes_before}M`)
    lines.push('END:VALARM')
  }

  const statusMap: Record<string, string> = {
    confirmed: 'CONFIRMED',
    tentative: 'TENTATIVE',
    cancelled: 'CANCELLED',
  }
  lines.push(`STATUS:${statusMap[event.status] || 'CONFIRMED'}`)

  lines.push(`CREATED:${toICalDate(event.created_at)}`)
  lines.push(`LAST-MODIFIED:${toICalDate(event.updated_at)}`)
  lines.push('END:VEVENT')

  return lines.map(foldLine).join('\r\n')
}

/**
 * Export events as a complete .ics calendar file
 */
export function exportICS(events: CalendarEvent[]): string {
  const lines: string[] = []
  lines.push('BEGIN:VCALENDAR')
  lines.push('VERSION:2.0')
  lines.push('PRODID:-//Reflectt AI//Calendar v1//EN')
  lines.push('CALSCALE:GREGORIAN')
  lines.push('METHOD:PUBLISH')
  lines.push(`X-WR-CALNAME:Reflectt Calendar`)

  for (const event of events) {
    lines.push(eventToVEvent(event))
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

/**
 * Export a single event as .ics
 */
export function exportEventICS(event: CalendarEvent): string {
  return exportICS([event])
}

// ── ICS Parsing ────────────────────────────────────────────────────────────

interface ParsedLine {
  name: string
  params: Record<string, string>
  value: string
}

/**
 * Parse an iCal content line into name, params, value
 */
function parseContentLine(line: string): ParsedLine {
  // Handle property parameters (e.g., ATTENDEE;CN=Name;PARTSTAT=ACCEPTED:mailto:...)
  const colonIdx = line.indexOf(':')
  if (colonIdx === -1) return { name: line, params: {}, value: '' }

  const beforeColon = line.slice(0, colonIdx)
  const value = line.slice(colonIdx + 1)

  const semiIdx = beforeColon.indexOf(';')
  if (semiIdx === -1) {
    return { name: beforeColon.toUpperCase(), params: {}, value }
  }

  const name = beforeColon.slice(0, semiIdx).toUpperCase()
  const paramStr = beforeColon.slice(semiIdx + 1)
  const params: Record<string, string> = {}

  // Parse params like CN=Name;PARTSTAT=ACCEPTED
  for (const part of paramStr.split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx !== -1) {
      params[part.slice(0, eqIdx).toUpperCase()] = part.slice(eqIdx + 1)
    }
  }

  return { name, params, value }
}

/**
 * Unfold continuation lines (lines starting with space or tab)
 */
function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const result: string[] = []

  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && result.length > 0) {
      result[result.length - 1] += line.slice(1)
    } else {
      result.push(line)
    }
  }

  return result.filter(l => l.length > 0)
}

/**
 * Unescape iCal text values
 */
function unescapeText(text: string): string {
  return text
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/**
 * Parse an iCal datetime string to epoch ms
 */
function parseICalDate(value: string): number {
  // Handle YYYYMMDDTHHMMSSZ and YYYYMMDD formats
  const cleaned = value.replace(/[^0-9TZ]/g, '')

  if (cleaned.length >= 15) {
    // Full datetime: YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMSS
    const year = parseInt(cleaned.slice(0, 4), 10)
    const month = parseInt(cleaned.slice(4, 6), 10) - 1
    const day = parseInt(cleaned.slice(6, 8), 10)
    const hour = parseInt(cleaned.slice(9, 11), 10)
    const min = parseInt(cleaned.slice(11, 13), 10)
    const sec = parseInt(cleaned.slice(13, 15), 10)
    return Date.UTC(year, month, day, hour, min, sec)
  } else if (cleaned.length >= 8) {
    // Date only: YYYYMMDD
    const year = parseInt(cleaned.slice(0, 4), 10)
    const month = parseInt(cleaned.slice(4, 6), 10) - 1
    const day = parseInt(cleaned.slice(6, 8), 10)
    return Date.UTC(year, month, day)
  }

  return Date.parse(value) || 0
}

/**
 * Parse TRIGGER value to minutes before
 * Handles: -PT10M, -PT1H, -P1D, PT0S
 */
function parseTrigger(value: string): number {
  const negative = value.startsWith('-')
  const cleaned = value.replace(/^-/, '')

  let minutes = 0

  // Match P[n]D or PT[n]H[n]M[n]S patterns
  const dayMatch = cleaned.match(/P(\d+)D/)
  if (dayMatch) minutes += parseInt(dayMatch[1], 10) * 1440

  const hourMatch = cleaned.match(/(\d+)H/)
  if (hourMatch) minutes += parseInt(hourMatch[1], 10) * 60

  const minMatch = cleaned.match(/(\d+)M/)
  if (minMatch) minutes += parseInt(minMatch[1], 10)

  return negative ? minutes : -minutes // Negative trigger = before event
}

interface ParsedVEvent {
  uid?: string
  summary: string
  description: string
  dtstart: number
  dtend: number
  timezone: string
  rrule: string | null
  organizer: string
  attendees: Attendee[]
  location: string
  categories: string[]
  reminders: Reminder[]
  status: 'confirmed' | 'tentative' | 'cancelled'
}

/**
 * Parse a VEVENT block from unfolded lines
 */
function parseVEvent(lines: string[]): ParsedVEvent {
  const event: ParsedVEvent = {
    summary: '',
    description: '',
    dtstart: 0,
    dtend: 0,
    timezone: 'UTC',
    rrule: null,
    organizer: '',
    attendees: [],
    location: '',
    categories: [],
    reminders: [],
    status: 'confirmed',
  }

  let inAlarm = false
  let alarmTrigger = 0

  for (const line of lines) {
    if (line === 'BEGIN:VALARM') { inAlarm = true; continue }
    if (line === 'END:VALARM') {
      if (alarmTrigger > 0) {
        event.reminders.push({ minutes_before: alarmTrigger, method: 'chat' })
      }
      inAlarm = false
      alarmTrigger = 0
      continue
    }

    if (inAlarm) {
      const parsed = parseContentLine(line)
      if (parsed.name === 'TRIGGER') {
        alarmTrigger = parseTrigger(parsed.value)
      }
      continue
    }

    const parsed = parseContentLine(line)

    switch (parsed.name) {
      case 'UID':
        event.uid = parsed.value
        break
      case 'SUMMARY':
        event.summary = unescapeText(parsed.value)
        break
      case 'DESCRIPTION':
        event.description = unescapeText(parsed.value)
        break
      case 'DTSTART':
        event.dtstart = parseICalDate(parsed.value)
        if (parsed.params.TZID) event.timezone = parsed.params.TZID
        break
      case 'DTEND':
        event.dtend = parseICalDate(parsed.value)
        break
      case 'RRULE':
        event.rrule = parsed.value
        break
      case 'ORGANIZER': {
        const cn = parsed.params.CN
        if (cn) {
          event.organizer = unescapeText(cn)
        } else {
          // Extract from mailto:
          event.organizer = parsed.value.replace(/^mailto:/i, '').split('@')[0]
        }
        break
      }
      case 'ATTENDEE': {
        const name = parsed.params.CN ? unescapeText(parsed.params.CN) : parsed.value.replace(/^mailto:/i, '').split('@')[0]
        const partstat = (parsed.params.PARTSTAT || 'NEEDS-ACTION').toLowerCase()
        const statusMap: Record<string, Attendee['status']> = {
          'accepted': 'accepted',
          'declined': 'declined',
          'tentative': 'tentative',
          'needs-action': 'needs-action',
        }
        const email = parsed.value.replace(/^mailto:/i, '')
        event.attendees.push({
          name,
          email: email || undefined,
          status: statusMap[partstat] || 'needs-action',
        })
        break
      }
      case 'LOCATION':
        event.location = unescapeText(parsed.value)
        break
      case 'CATEGORIES':
        event.categories = parsed.value.split(',').map(c => unescapeText(c.trim()))
        break
      case 'STATUS': {
        const s = parsed.value.toUpperCase()
        if (s === 'TENTATIVE') event.status = 'tentative'
        else if (s === 'CANCELLED') event.status = 'cancelled'
        else event.status = 'confirmed'
        break
      }
    }
  }

  // Default end time if not specified (1 hour after start)
  if (event.dtstart && !event.dtend) {
    event.dtend = event.dtstart + 60 * 60 * 1000
  }

  return event
}

/**
 * Parse an .ics file into event objects
 */
export function parseICS(icsContent: string): ParsedVEvent[] {
  const lines = unfoldLines(icsContent)
  const events: ParsedVEvent[] = []

  let currentEventLines: string[] = []
  let inEvent = false

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true
      currentEventLines = []
      continue
    }
    if (line === 'END:VEVENT') {
      inEvent = false
      events.push(parseVEvent(currentEventLines))
      continue
    }
    if (inEvent) {
      currentEventLines.push(line)
    }
  }

  return events
}

/**
 * Import events from .ics content. Returns created events.
 * If an event with the same UID already exists, it's updated instead.
 */
export function importICS(icsContent: string, defaultOrganizer = 'imported'): CalendarEvent[] {
  const parsed = parseICS(icsContent)
  const results: CalendarEvent[] = []

  for (const vevent of parsed) {
    if (!vevent.summary || !vevent.dtstart) continue

    // Check if event with same UID already exists
    const existing = vevent.uid ? calendarEvents.getEventByUid(vevent.uid) : null

    if (existing) {
      // Update existing event
      const updated = calendarEvents.updateEvent(existing.id, {
        summary: vevent.summary,
        description: vevent.description,
        dtstart: vevent.dtstart,
        dtend: vevent.dtend,
        timezone: vevent.timezone,
        rrule: vevent.rrule,
        location: vevent.location,
        categories: vevent.categories,
        reminders: vevent.reminders,
        attendees: vevent.attendees,
        status: vevent.status,
      })
      if (updated) results.push(updated)
    } else {
      // Create new event (preserve UID from .ics for future re-imports)
      const input: CreateEventInput = {
        summary: vevent.summary,
        description: vevent.description,
        dtstart: vevent.dtstart,
        dtend: vevent.dtend,
        timezone: vevent.timezone,
        rrule: vevent.rrule,
        organizer: vevent.organizer || defaultOrganizer,
        attendees: vevent.attendees,
        location: vevent.location,
        categories: vevent.categories,
        reminders: vevent.reminders,
        status: vevent.status,
        uid: vevent.uid,
      }
      try {
        const event = calendarEvents.createEvent(input)
        results.push(event)
      } catch (err) {
        // Skip invalid events, log warning
        console.warn(`[Calendar] Skipped invalid event "${vevent.summary}": ${err}`)
      }
    }
  }

  return results
}
