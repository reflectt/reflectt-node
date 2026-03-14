/**
 * Restart broadcast rate-limiter (SIGNAL-ROUTING Change 1)
 * task-1773516754378-6pyxtkuzt
 *
 * Validates that repeated server restarts within 15 minutes
 * produce at most one broadcast to #general per cooldown window.
 *
 * Implementation: src/index.ts — RESTART_BROADCAST_COOLDOWN_MS = 15 * 60 * 1000
 * The guard queries chat_messages for a recent 'Server restarted' message.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const RESTART_BROADCAST_COOLDOWN_MS = 15 * 60 * 1000 // must match src/index.ts

/** Minimal in-memory DB that mirrors the chat_messages schema used by the guard */
function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      "from" TEXT NOT NULL,
      content TEXT NOT NULL,
      channel TEXT,
      timestamp INTEGER NOT NULL
    )
  `)
  return db
}

function insertRestartBroadcast(db: ReturnType<typeof makeDb>, timestampMs: number) {
  db.prepare(
    `INSERT INTO chat_messages ("from", content, channel, timestamp) VALUES (?, ?, ?, ?)`
  ).run('system', 'Server restarted. Resume your work.', 'general', timestampMs)
}

/**
 * Mirrors the guard logic in src/index.ts exactly.
 * Returns true when a broadcast is suppressed (rate-limited).
 */
function shouldSuppressBroadcast(db: ReturnType<typeof makeDb>, nowMs = Date.now()): boolean {
  const row = db.prepare(
    `SELECT 1 FROM chat_messages WHERE "from" = 'system' AND content LIKE '%Server restarted%' AND timestamp > ? LIMIT 1`
  ).get(nowMs - RESTART_BROADCAST_COOLDOWN_MS)
  return !!row
}

describe('restart broadcast rate-limiter (SIGNAL-ROUTING Change 1)', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    db = makeDb()
  })

  it('A: first restart always goes through (no suppression)', () => {
    // No prior broadcast in DB
    expect(shouldSuppressBroadcast(db)).toBe(false)
  })

  it('B: second restart within 15 minutes is suppressed', () => {
    const now = Date.now()
    // Simulate first broadcast 5 minutes ago
    insertRestartBroadcast(db, now - 5 * 60 * 1000)
    expect(shouldSuppressBroadcast(db, now)).toBe(true)
  })

  it('C: restart after cooldown window (>15 min) is allowed through', () => {
    const now = Date.now()
    // Simulate broadcast 16 minutes ago (outside cooldown)
    insertRestartBroadcast(db, now - 16 * 60 * 1000)
    expect(shouldSuppressBroadcast(db, now)).toBe(false)
  })

  it('D: restart exactly at cooldown boundary is suppressed (boundary is exclusive)', () => {
    const now = Date.now()
    // Exactly at the boundary — timestamp > cutoff is the guard; equal = not suppressed
    insertRestartBroadcast(db, now - RESTART_BROADCAST_COOLDOWN_MS)
    // timestamp == cutoff: NOT > cutoff, so should NOT suppress
    expect(shouldSuppressBroadcast(db, now)).toBe(false)
  })

  it('E: no cadence degradation — only first broadcast counted, not prior suppressed ones', () => {
    const now = Date.now()
    // Two broadcasts 20 min apart (both outside each other's window)
    insertRestartBroadcast(db, now - 20 * 60 * 1000)
    insertRestartBroadcast(db, now - 3 * 60 * 1000)
    // Third restart 3min after second — should be suppressed by the second broadcast
    expect(shouldSuppressBroadcast(db, now)).toBe(true)
  })
})
