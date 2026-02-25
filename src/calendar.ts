// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Calendar — Shared time-awareness for agents and humans
 *
 * Stores calendar blocks (busy, focus, available, ooo) per agent.
 * Supports one-off and recurring blocks (weekly pattern).
 * Provides availability queries for ping gating and coordination.
 */

import { getDb } from './db.js'

// ── Types ──────────────────────────────────────────────────────────────────

export type BlockType = 'busy' | 'focus' | 'available' | 'ooo'

export interface CalendarBlock {
  id: string
  agent: string
  type: BlockType
  title: string
  start: number        // epoch ms (for one-off) or minutes-from-midnight (for recurring)
  end: number          // epoch ms (for one-off) or minutes-from-midnight (for recurring)
  recurring: string | null  // null = one-off, or comma-separated days: "mon,tue,wed,thu,fri"
  timezone: string     // IANA timezone for recurring blocks
  created_at: number
  updated_at: number
}

export interface CreateBlockInput {
  agent: string
  type: BlockType
  title: string
  start: number
  end: number
  recurring?: string | null
  timezone?: string
}

export interface UpdateBlockInput {
  type?: BlockType
  title?: string
  start?: number
  end?: number
  recurring?: string | null
  timezone?: string
}

export interface AvailabilityStatus {
  agent: string
  status: 'free' | 'busy' | 'focus' | 'ooo'
  current_block: CalendarBlock | null
  until: number | null  // when current status ends (epoch ms)
}

export interface PingDecision {
  should_ping: boolean
  reason: string
  delay_until: number | null  // epoch ms — when to retry
  current_block: CalendarBlock | null
}

// ── Valid block types and days ─────────────────────────────────────────────

const VALID_BLOCK_TYPES: BlockType[] = ['busy', 'focus', 'available', 'ooo']
const VALID_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

// ── Database setup ─────────────────────────────────────────────────────────

let initialized = false

function ensureTable(): void {
  if (initialized) return
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_blocks (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('busy', 'focus', 'available', 'ooo')),
      title TEXT NOT NULL DEFAULT '',
      start INTEGER NOT NULL,
      end INTEGER NOT NULL,
      recurring TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_calendar_agent ON calendar_blocks(agent)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_calendar_type ON calendar_blocks(type)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_calendar_start ON calendar_blocks(start)`)
  initialized = true
}

// ── ID generation ──────────────────────────────────────────────────────────

function generateId(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 10)
  return `cal-${ts}-${rand}`
}

// ── Validation ─────────────────────────────────────────────────────────────

function validateBlockInput(input: CreateBlockInput): string[] {
  const errors: string[] = []

  if (!input.agent || typeof input.agent !== 'string' || input.agent.trim() === '') {
    errors.push('agent is required')
  }
  if (!VALID_BLOCK_TYPES.includes(input.type)) {
    errors.push(`type must be one of: ${VALID_BLOCK_TYPES.join(', ')}`)
  }
  if (typeof input.start !== 'number' || isNaN(input.start)) {
    errors.push('start must be a number')
  }
  if (typeof input.end !== 'number' || isNaN(input.end)) {
    errors.push('end must be a number')
  }

  if (input.recurring) {
    const days = input.recurring.split(',').map(d => d.trim().toLowerCase())
    for (const day of days) {
      if (!VALID_DAYS.includes(day)) {
        errors.push(`Invalid recurring day: "${day}". Valid: ${VALID_DAYS.join(', ')}`)
      }
    }
    // For recurring: start/end are minutes from midnight (0-1439)
    if (input.start < 0 || input.start > 1439) {
      errors.push('For recurring blocks, start must be minutes from midnight (0-1439)')
    }
    if (input.end < 0 || input.end > 1439) {
      errors.push('For recurring blocks, end must be minutes from midnight (0-1439)')
    }
  } else {
    // For one-off: start/end are epoch ms, end must be after start
    if (input.end <= input.start) {
      errors.push('end must be after start for one-off blocks')
    }
  }

  return errors
}

// ── CRUD operations ────────────────────────────────────────────────────────

export function createBlock(input: CreateBlockInput): CalendarBlock {
  ensureTable()
  const errors = validateBlockInput(input)
  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join('; ')}`)
  }

  const db = getDb()
  const now = Date.now()
  const block: CalendarBlock = {
    id: generateId(),
    agent: input.agent.trim(),
    type: input.type,
    title: (input.title || '').trim(),
    start: input.start,
    end: input.end,
    recurring: input.recurring ? input.recurring.toLowerCase().trim() : null,
    timezone: input.timezone || 'UTC',
    created_at: now,
    updated_at: now,
  }

  db.prepare(`
    INSERT INTO calendar_blocks (id, agent, type, title, start, end, recurring, timezone, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(block.id, block.agent, block.type, block.title, block.start, block.end, block.recurring, block.timezone, block.created_at, block.updated_at)

  return block
}

export function getBlock(id: string): CalendarBlock | null {
  ensureTable()
  const db = getDb()
  const row = db.prepare('SELECT * FROM calendar_blocks WHERE id = ?').get(id) as CalendarBlock | undefined
  return row || null
}

export function listBlocks(filters?: {
  agent?: string
  type?: BlockType
  from?: number  // epoch ms
  to?: number    // epoch ms
}): CalendarBlock[] {
  ensureTable()
  const db = getDb()
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters?.agent) {
    conditions.push('agent = ?')
    params.push(filters.agent)
  }
  if (filters?.type) {
    conditions.push('type = ?')
    params.push(filters.type)
  }
  // For one-off blocks, filter by time range
  // Recurring blocks are always included (they repeat)
  if (filters?.from || filters?.to) {
    const timeClauses: string[] = []
    if (filters.from && filters.to) {
      // One-off blocks that overlap with the range, OR any recurring block
      timeClauses.push('(recurring IS NOT NULL) OR (end > ? AND start < ?)')
      params.push(filters.from, filters.to)
    } else if (filters.from) {
      timeClauses.push('(recurring IS NOT NULL) OR (end > ?)')
      params.push(filters.from)
    } else if (filters.to) {
      timeClauses.push('(recurring IS NOT NULL) OR (start < ?)')
      params.push(filters.to)
    }
    if (timeClauses.length > 0) {
      conditions.push(`(${timeClauses.join(' AND ')})`)
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db.prepare(`SELECT * FROM calendar_blocks ${where} ORDER BY start ASC`).all(...params) as CalendarBlock[]
  return rows
}

export function updateBlock(id: string, input: UpdateBlockInput): CalendarBlock | null {
  ensureTable()
  const db = getDb()
  const existing = getBlock(id)
  if (!existing) return null

  const updates: string[] = []
  const params: unknown[] = []

  if (input.type !== undefined) {
    if (!VALID_BLOCK_TYPES.includes(input.type)) {
      throw new Error(`type must be one of: ${VALID_BLOCK_TYPES.join(', ')}`)
    }
    updates.push('type = ?')
    params.push(input.type)
  }
  if (input.title !== undefined) {
    updates.push('title = ?')
    params.push(input.title.trim())
  }
  if (input.start !== undefined) {
    updates.push('start = ?')
    params.push(input.start)
  }
  if (input.end !== undefined) {
    updates.push('end = ?')
    params.push(input.end)
  }
  if (input.recurring !== undefined) {
    updates.push('recurring = ?')
    params.push(input.recurring ? input.recurring.toLowerCase().trim() : null)
  }
  if (input.timezone !== undefined) {
    updates.push('timezone = ?')
    params.push(input.timezone)
  }

  if (updates.length === 0) return existing

  const now = Date.now()
  updates.push('updated_at = ?')
  params.push(now)
  params.push(id)

  db.prepare(`UPDATE calendar_blocks SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  return getBlock(id)
}

export function deleteBlock(id: string): boolean {
  ensureTable()
  const db = getDb()
  const result = db.prepare('DELETE FROM calendar_blocks WHERE id = ?').run(id)
  return (result as any).changes > 0
}

// ── Availability queries ───────────────────────────────────────────────────

/**
 * Check if a recurring block is active at the given time.
 */
function isRecurringBlockActive(block: CalendarBlock, atMs: number): boolean {
  if (!block.recurring) return false

  // Convert atMs to the block's timezone
  const date = new Date(atMs)
  let dayName: string
  let minutesFromMidnight: number

  try {
    // Get the day and time in the block's timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: block.timezone,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })
    const parts = formatter.formatToParts(date)
    const weekday = parts.find(p => p.type === 'weekday')?.value?.toLowerCase().slice(0, 3) || ''
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)
    dayName = weekday
    minutesFromMidnight = hour * 60 + minute
  } catch {
    // Fallback to UTC
    dayName = VALID_DAYS[date.getUTCDay()]
    minutesFromMidnight = date.getUTCHours() * 60 + date.getUTCMinutes()
  }

  const days = block.recurring.split(',').map(d => d.trim())
  if (!days.includes(dayName)) return false

  // Handle blocks that cross midnight (e.g., start=2300, end=100 means 11pm to 1am)
  if (block.start <= block.end) {
    return minutesFromMidnight >= block.start && minutesFromMidnight < block.end
  } else {
    // Crosses midnight
    return minutesFromMidnight >= block.start || minutesFromMidnight < block.end
  }
}

/**
 * Calculate when a recurring block ends (in epoch ms) given it's currently active.
 */
function recurringBlockEndMs(block: CalendarBlock, atMs: number): number {
  const date = new Date(atMs)
  let minutesFromMidnight: number

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: block.timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })
    const parts = formatter.formatToParts(date)
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)
    minutesFromMidnight = hour * 60 + minute
  } catch {
    minutesFromMidnight = date.getUTCHours() * 60 + date.getUTCMinutes()
  }

  let minutesUntilEnd: number
  if (block.start <= block.end) {
    minutesUntilEnd = block.end - minutesFromMidnight
  } else {
    // Crosses midnight
    if (minutesFromMidnight >= block.start) {
      minutesUntilEnd = (1440 - minutesFromMidnight) + block.end
    } else {
      minutesUntilEnd = block.end - minutesFromMidnight
    }
  }

  return atMs + minutesUntilEnd * 60 * 1000
}

/**
 * Get current availability for an agent.
 */
export function getAgentAvailability(agent: string, atMs?: number): AvailabilityStatus {
  const now = atMs || Date.now()
  const blocks = listBlocks({ agent })

  // Check one-off blocks first (more specific)
  for (const block of blocks) {
    if (!block.recurring && block.start <= now && block.end > now) {
      return {
        agent,
        status: block.type === 'available' ? 'free' : block.type,
        current_block: block,
        until: block.end,
      }
    }
  }

  // Check recurring blocks
  for (const block of blocks) {
    if (block.recurring && isRecurringBlockActive(block, now)) {
      return {
        agent,
        status: block.type === 'available' ? 'free' : block.type,
        current_block: block,
        until: recurringBlockEndMs(block, now),
      }
    }
  }

  return {
    agent,
    status: 'free',
    current_block: null,
    until: null,
  }
}

/**
 * Get availability for all agents that have calendar blocks.
 */
export function getTeamAvailability(atMs?: number): AvailabilityStatus[] {
  ensureTable()
  const db = getDb()
  const agents = db.prepare('SELECT DISTINCT agent FROM calendar_blocks ORDER BY agent').all() as { agent: string }[]
  return agents.map(({ agent }) => getAgentAvailability(agent, atMs))
}

/**
 * Should an agent be pinged right now?
 */
export function shouldPing(agent: string, urgency: 'low' | 'normal' | 'high' = 'normal'): PingDecision {
  // High urgency always pings (P0 incidents, etc.)
  if (urgency === 'high') {
    return { should_ping: true, reason: 'High urgency overrides calendar', delay_until: null, current_block: null }
  }

  const availability = getAgentAvailability(agent)

  switch (availability.status) {
    case 'free':
      return { should_ping: true, reason: 'Agent is free', delay_until: null, current_block: null }

    case 'focus':
      if (urgency === 'normal') {
        return {
          should_ping: false,
          reason: `Agent in focus block: "${availability.current_block?.title || 'Focus time'}"`,
          delay_until: availability.until,
          current_block: availability.current_block,
        }
      }
      // Low urgency — also delay
      return {
        should_ping: false,
        reason: `Agent in focus block: "${availability.current_block?.title || 'Focus time'}"`,
        delay_until: availability.until,
        current_block: availability.current_block,
      }

    case 'busy':
      if (urgency === 'normal') {
        return { should_ping: true, reason: 'Agent is busy but urgency is normal — ping allowed', delay_until: null, current_block: availability.current_block }
      }
      return {
        should_ping: false,
        reason: `Agent is busy: "${availability.current_block?.title || 'Busy'}"`,
        delay_until: availability.until,
        current_block: availability.current_block,
      }

    case 'ooo':
      return {
        should_ping: false,
        reason: `Agent is out of office: "${availability.current_block?.title || 'OOO'}"`,
        delay_until: availability.until,
        current_block: availability.current_block,
      }

    default:
      return { should_ping: true, reason: 'No calendar data', delay_until: null, current_block: null }
  }
}

// ── Calendar manager (singleton) ───────────────────────────────────────────

export const calendarManager = {
  createBlock,
  getBlock,
  listBlocks,
  updateBlock,
  deleteBlock,
  getAgentAvailability,
  getTeamAvailability,
  shouldPing,
}
