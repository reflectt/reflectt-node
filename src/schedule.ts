// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Schedule — Shared time-awareness feed for the team
 *
 * Provides canonical records for team-wide scheduling primitives:
 *   - deploy_window:    when deploys are safe/unsafe
 *   - focus_block:      team-wide quiet periods (low interruptions)
 *   - scheduled_task:   task work scheduled for a specific time window
 *
 * Intentionally NOT in scope (MVP):
 *   - No full calendar UI
 *   - No iCal/RRULE integration (use calendar.ts for per-agent recurring blocks)
 *   - No reminder/notification engine (use calendar-reminder-engine.ts)
 *   - No per-agent availability (use calendar.ts + getAvailability())
 *   - No recurring rules — one-off windows only in v1
 *
 * The /schedule/feed endpoint returns upcoming items chronologically so agents
 * can read shared timing data instead of coordinating via chat.
 */

import { getDb } from './db.js'

// ── Types ──────────────────────────────────────────────────────────────────

export type ScheduleKind = 'deploy_window' | 'focus_block' | 'scheduled_task'

export interface ScheduleEntry {
  id: string
  kind: ScheduleKind
  title: string
  /** Epoch ms — start of window */
  start: number
  /** Epoch ms — end of window */
  end: number
  /** Agent or team identifier that owns / created this entry */
  owner: string
  /** Optional task ID for scheduled_task entries */
  task_id: string | null
  /** deploy_window: 'open'|'closed'; focus_block: 'active'; scheduled_task: 'pending'|'done' */
  status: string
  /** Free-form metadata (JSON string) */
  meta: string | null
  created_at: number
  updated_at: number
}

export interface CreateScheduleEntryInput {
  kind: ScheduleKind
  title: string
  start: number
  end: number
  owner: string
  task_id?: string | null
  status?: string
  meta?: Record<string, unknown>
}

export interface UpdateScheduleEntryInput {
  title?: string
  start?: number
  end?: number
  status?: string
  meta?: Record<string, unknown>
}

export interface ScheduleFeedOptions {
  /** Only return entries starting/ending after this epoch ms (default: now) */
  after?: number
  /** Only return entries starting before this epoch ms */
  before?: number
  /** Filter by kind(s) */
  kinds?: ScheduleKind[]
  /** Filter by owner */
  owner?: string
  /** Max entries to return (default: 50) */
  limit?: number
}

// ── Valid values ───────────────────────────────────────────────────────────

const VALID_KINDS: ScheduleKind[] = ['deploy_window', 'focus_block', 'scheduled_task']

const DEFAULT_STATUS: Record<ScheduleKind, string> = {
  deploy_window: 'open',
  focus_block: 'active',
  scheduled_task: 'pending',
}

// ── Database setup ─────────────────────────────────────────────────────────

let initialized = false

function ensureTable(): void {
  if (initialized) return
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_entries (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('deploy_window', 'focus_block', 'scheduled_task')),
      title TEXT NOT NULL,
      start INTEGER NOT NULL,
      end INTEGER NOT NULL,
      owner TEXT NOT NULL,
      task_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      meta TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_schedule_start ON schedule_entries(start)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_schedule_kind ON schedule_entries(kind)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_schedule_owner ON schedule_entries(owner)`)
  initialized = true
}

// ── CRUD ───────────────────────────────────────────────────────────────────

function generateId(kind: ScheduleKind): string {
  const prefix = kind === 'deploy_window' ? 'dw' : kind === 'focus_block' ? 'fb' : 'st'
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createScheduleEntry(input: CreateScheduleEntryInput): ScheduleEntry {
  ensureTable()
  const db = getDb()
  const now = Date.now()

  if (!VALID_KINDS.includes(input.kind)) {
    throw new Error(`kind must be one of: ${VALID_KINDS.join(', ')}`)
  }
  if (!input.title?.trim()) throw new Error('title is required')
  if (typeof input.start !== 'number' || isNaN(input.start)) throw new Error('start must be epoch ms')
  if (typeof input.end !== 'number' || isNaN(input.end)) throw new Error('end must be epoch ms')
  if (input.end <= input.start) throw new Error('end must be after start')
  if (!input.owner?.trim()) throw new Error('owner is required')

  const entry: ScheduleEntry = {
    id: generateId(input.kind),
    kind: input.kind,
    title: input.title.trim(),
    start: input.start,
    end: input.end,
    owner: input.owner.trim(),
    task_id: input.task_id ?? null,
    status: input.status ?? DEFAULT_STATUS[input.kind],
    meta: input.meta ? JSON.stringify(input.meta) : null,
    created_at: now,
    updated_at: now,
  }

  db.prepare(`
    INSERT INTO schedule_entries (id, kind, title, start, end, owner, task_id, status, meta, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id, entry.kind, entry.title, entry.start, entry.end,
    entry.owner, entry.task_id, entry.status, entry.meta,
    entry.created_at, entry.updated_at,
  )

  return entry
}

export function getScheduleEntry(id: string): ScheduleEntry | null {
  ensureTable()
  const db = getDb()
  return (db.prepare('SELECT * FROM schedule_entries WHERE id = ?').get(id) as ScheduleEntry | undefined) ?? null
}

export function updateScheduleEntry(id: string, input: UpdateScheduleEntryInput): ScheduleEntry | null {
  ensureTable()
  const db = getDb()
  const existing = getScheduleEntry(id)
  if (!existing) return null

  const now = Date.now()
  const updated: ScheduleEntry = {
    ...existing,
    title: input.title?.trim() ?? existing.title,
    start: input.start ?? existing.start,
    end: input.end ?? existing.end,
    status: input.status ?? existing.status,
    meta: input.meta ? JSON.stringify(input.meta) : existing.meta,
    updated_at: now,
  }

  if (updated.end <= updated.start) throw new Error('end must be after start')

  db.prepare(`
    UPDATE schedule_entries
    SET title = ?, start = ?, end = ?, status = ?, meta = ?, updated_at = ?
    WHERE id = ?
  `).run(updated.title, updated.start, updated.end, updated.status, updated.meta, now, id)

  return updated
}

export function deleteScheduleEntry(id: string): boolean {
  ensureTable()
  const db = getDb()
  const result = db.prepare('DELETE FROM schedule_entries WHERE id = ?').run(id)
  return result.changes > 0
}

// ── Feed query ─────────────────────────────────────────────────────────────

/**
 * Returns upcoming schedule entries in chronological order.
 * Default: all entries ending after now, ordered by start asc.
 */
export function getScheduleFeed(options: ScheduleFeedOptions = {}): ScheduleEntry[] {
  ensureTable()
  const db = getDb()

  const now = Date.now()
  const after = options.after ?? now
  const before = options.before
  const limit = Math.min(options.limit ?? 50, 200)

  const conditions: string[] = ['end > ?']
  const params: unknown[] = [after]

  if (before !== undefined) {
    conditions.push('start < ?')
    params.push(before)
  }

  if (options.kinds?.length) {
    conditions.push(`kind IN (${options.kinds.map(() => '?').join(', ')})`)
    params.push(...options.kinds)
  }

  if (options.owner) {
    conditions.push('owner = ?')
    params.push(options.owner)
  }

  params.push(limit)

  const rows = db.prepare(`
    SELECT * FROM schedule_entries
    WHERE ${conditions.join(' AND ')}
    ORDER BY start ASC
    LIMIT ?
  `).all(...params) as ScheduleEntry[]

  return rows
}

// ── Test reset ─────────────────────────────────────────────────────────────

export function _resetScheduleStore(): void {
  initialized = false
  try {
    const db = getDb()
    db.exec('DELETE FROM schedule_entries')
  } catch { /* ok in tests */ }
}
