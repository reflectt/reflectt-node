// SPDX-License-Identifier: Apache-2.0
// Pause/sleep controls — pause agent or whole team with optional resume time.
//
// Storage: SQLite table `pause_state` with scope (agent name or '__team__'),
// paused flag, optional pausedUntil timestamp, and reason.

import { getDb } from './db.js'

const TEAM_SCOPE = '__team__'

export interface PauseEntry {
  scope: string
  paused: boolean
  pausedAt: number | null
  pausedUntil: number | null
  reason: string | null
  pausedBy: string | null
}

function ensureTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS pause_state (
      scope TEXT PRIMARY KEY,
      paused INTEGER NOT NULL DEFAULT 0,
      paused_at INTEGER,
      paused_until INTEGER,
      reason TEXT,
      paused_by TEXT
    )
  `)
}

/** Pause an agent or the whole team. */
export function setPaused(opts: {
  scope: 'team' | string
  paused: boolean
  pausedUntil?: number
  reason?: string
  pausedBy?: string
}): PauseEntry {
  ensureTable()
  const db = getDb()
  const key = opts.scope === 'team' ? TEAM_SCOPE : opts.scope.toLowerCase()
  const now = Date.now()

  if (opts.paused) {
    db.prepare(`
      INSERT INTO pause_state (scope, paused, paused_at, paused_until, reason, paused_by)
      VALUES (?, 1, ?, ?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET
        paused = 1,
        paused_at = excluded.paused_at,
        paused_until = excluded.paused_until,
        reason = excluded.reason,
        paused_by = excluded.paused_by
    `).run(key, now, opts.pausedUntil ?? null, opts.reason ?? null, opts.pausedBy ?? null)
  } else {
    db.prepare(`
      UPDATE pause_state SET paused = 0, paused_until = NULL WHERE scope = ?
    `).run(key)
  }

  return getEntry(key)
}

function getEntry(scope: string): PauseEntry {
  ensureTable()
  const db = getDb()
  const row = db.prepare('SELECT * FROM pause_state WHERE scope = ?').get(scope) as {
    scope: string; paused: number; paused_at: number | null;
    paused_until: number | null; reason: string | null; paused_by: string | null
  } | undefined

  if (!row) {
    return { scope, paused: false, pausedAt: null, pausedUntil: null, reason: null, pausedBy: null }
  }

  // Auto-resume: if pausedUntil has passed, clear the pause
  if (row.paused && row.paused_until && row.paused_until <= Date.now()) {
    db.prepare('UPDATE pause_state SET paused = 0, paused_until = NULL WHERE scope = ?').run(scope)
    return { scope, paused: false, pausedAt: row.paused_at, pausedUntil: null, reason: row.reason, pausedBy: row.paused_by }
  }

  return {
    scope,
    paused: row.paused === 1,
    pausedAt: row.paused_at,
    pausedUntil: row.paused_until,
    reason: row.reason,
    pausedBy: row.paused_by,
  }
}

/** Check if an agent is paused (either individually or team-wide). */
export function isPaused(agent?: string): {
  paused: boolean
  scope: 'team' | 'agent' | null
  entry: PauseEntry | null
  remainingMs: number | null
} {
  // Check team-wide pause first
  const teamEntry = getEntry(TEAM_SCOPE)
  if (teamEntry.paused) {
    return {
      paused: true,
      scope: 'team',
      entry: teamEntry,
      remainingMs: teamEntry.pausedUntil ? Math.max(0, teamEntry.pausedUntil - Date.now()) : null,
    }
  }

  // Check agent-specific pause
  if (agent) {
    const agentEntry = getEntry(agent.toLowerCase())
    if (agentEntry.paused) {
      return {
        paused: true,
        scope: 'agent',
        entry: agentEntry,
        remainingMs: agentEntry.pausedUntil ? Math.max(0, agentEntry.pausedUntil - Date.now()) : null,
      }
    }
  }

  return { paused: false, scope: null, entry: null, remainingMs: null }
}

/** Get all pause entries (for dashboard). */
export function getPauseStatus(): { team: PauseEntry; agents: PauseEntry[] } {
  ensureTable()
  const db = getDb()
  const rows = db.prepare('SELECT * FROM pause_state').all() as Array<{
    scope: string; paused: number; paused_at: number | null;
    paused_until: number | null; reason: string | null; paused_by: string | null
  }>

  let team = getEntry(TEAM_SCOPE)
  const agents: PauseEntry[] = []

  for (const row of rows) {
    if (row.scope === TEAM_SCOPE) continue
    const entry = getEntry(row.scope)
    if (entry.paused) agents.push(entry)
  }

  return { team, agents }
}

/** Format remaining time for display. */
export function formatRemaining(ms: number | null): string {
  if (ms === null) return 'indefinite'
  if (ms <= 0) return 'resuming now'
  const mins = Math.ceil(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remainMins = mins % 60
  return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`
}
