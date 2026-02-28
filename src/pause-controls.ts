// SPDX-License-Identifier: Apache-2.0
// Pause/sleep controls: pause individual agents or the whole team
// When paused, /tasks/next refuses to assign new work.

import { getDb, safeJsonStringify, safeJsonParse } from './db.js'

// ── Types ──

export interface PauseEntry {
  target: string         // agent name or '__team__' for team-wide
  paused: boolean
  pausedAt: number
  pausedUntil: number | null  // null = indefinite
  pausedBy: string       // who triggered the pause
  reason: string
}

export interface PauseStatus {
  paused: boolean
  entry: PauseEntry | null
  remainingMs: number | null
  message: string
}

// ── DB ──

function ensurePauseTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS pause_controls (
      target TEXT PRIMARY KEY,
      paused INTEGER NOT NULL DEFAULT 0,
      paused_at INTEGER NOT NULL,
      paused_until INTEGER,
      paused_by TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT ''
    );
  `)
}

// ── Core ──

const TEAM_TARGET = '__team__'

function getEntry(target: string): PauseEntry | null {
  ensurePauseTable()
  const db = getDb()
  const row = db.prepare('SELECT * FROM pause_controls WHERE target = ?').get(target) as Record<string, unknown> | undefined
  if (!row) return null

  return {
    target: String(row.target),
    paused: Boolean(row.paused),
    pausedAt: Number(row.paused_at) || 0,
    pausedUntil: row.paused_until ? Number(row.paused_until) : null,
    pausedBy: String(row.paused_by || ''),
    reason: String(row.reason || ''),
  }
}

function upsertPause(target: string, opts: { pausedUntil?: number | null; pausedBy: string; reason: string }): PauseEntry {
  ensurePauseTable()
  const db = getDb()
  const now = Date.now()

  db.prepare(`
    INSERT INTO pause_controls (target, paused, paused_at, paused_until, paused_by, reason)
    VALUES (?, 1, ?, ?, ?, ?)
    ON CONFLICT(target) DO UPDATE SET
      paused = 1,
      paused_at = excluded.paused_at,
      paused_until = excluded.paused_until,
      paused_by = excluded.paused_by,
      reason = excluded.reason
  `).run(target, now, opts.pausedUntil ?? null, opts.pausedBy, opts.reason)

  return getEntry(target)!
}

function removePause(target: string): boolean {
  ensurePauseTable()
  const db = getDb()
  const result = db.prepare('UPDATE pause_controls SET paused = 0 WHERE target = ?').run(target)
  return result.changes > 0
}

// ── Auto-expire check ──

function isExpired(entry: PauseEntry): boolean {
  if (!entry.paused) return true
  if (!entry.pausedUntil) return false // indefinite
  return Date.now() >= entry.pausedUntil
}

// ── Public API ──

/** Pause an agent or the team */
export function pauseTarget(target: string, opts: { pausedUntil?: number | null; pausedBy: string; reason: string }): PauseEntry {
  const key = target === 'team' ? TEAM_TARGET : target.toLowerCase()
  return upsertPause(key, opts)
}

/** Unpause an agent or the team */
export function unpauseTarget(target: string): { success: boolean } {
  const key = target === 'team' ? TEAM_TARGET : target.toLowerCase()
  return { success: removePause(key) }
}

/** Check if an agent is paused (directly or via team pause) */
export function checkPauseStatus(agent: string): PauseStatus {
  const agentKey = agent.toLowerCase()

  // Check team-wide pause first
  const teamEntry = getEntry(TEAM_TARGET)
  if (teamEntry && teamEntry.paused && !isExpired(teamEntry)) {
    const remainingMs = teamEntry.pausedUntil ? teamEntry.pausedUntil - Date.now() : null
    return {
      paused: true,
      entry: teamEntry,
      remainingMs,
      message: `Team paused by ${teamEntry.pausedBy}: ${teamEntry.reason}${remainingMs ? ` (${Math.ceil(remainingMs / 60000)}m remaining)` : ' (indefinite)'}`,
    }
  }

  // Auto-expire team pause
  if (teamEntry && teamEntry.paused && isExpired(teamEntry)) {
    removePause(TEAM_TARGET)
  }

  // Check agent-specific pause
  const agentEntry = getEntry(agentKey)
  if (agentEntry && agentEntry.paused && !isExpired(agentEntry)) {
    const remainingMs = agentEntry.pausedUntil ? agentEntry.pausedUntil - Date.now() : null
    return {
      paused: true,
      entry: agentEntry,
      remainingMs,
      message: `${agent} paused by ${agentEntry.pausedBy}: ${agentEntry.reason}${remainingMs ? ` (${Math.ceil(remainingMs / 60000)}m remaining)` : ' (indefinite)'}`,
    }
  }

  // Auto-expire agent pause
  if (agentEntry && agentEntry.paused && isExpired(agentEntry)) {
    removePause(agentKey)
  }

  return { paused: false, entry: null, remainingMs: null, message: 'Active' }
}

/** List all pause entries (active + expired) */
export function listPauseEntries(): PauseEntry[] {
  ensurePauseTable()
  const db = getDb()
  const rows = db.prepare('SELECT * FROM pause_controls ORDER BY paused_at DESC').all() as Array<Record<string, unknown>>
  return rows.map(row => ({
    target: String(row.target),
    paused: Boolean(row.paused),
    pausedAt: Number(row.paused_at) || 0,
    pausedUntil: row.paused_until ? Number(row.paused_until) : null,
    pausedBy: String(row.paused_by || ''),
    reason: String(row.reason || ''),
  }))
}

/** Get team pause status specifically */
export function getTeamPauseStatus(): PauseStatus {
  return checkPauseStatus(TEAM_TARGET)
}
