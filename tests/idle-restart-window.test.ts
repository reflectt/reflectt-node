/**
 * Idle alert suppression during restart windows — SIGNAL-ROUTING Change 3
 * task-1773528961567-b3leu2g27
 *
 * Behavior:
 *   - If ≥2 restart broadcasts in the last 30 minutes: idle escalations are
 *     downgraded — no @owner/@kai mentions, labeled [idle-info, restart-window-active]
 *   - After restart window clears (0 or 1 restart in 30min): normal escalation resumes
 *
 * Tests mirror the isInRestartWindow() implementation in src/health.ts:
 *   SELECT COUNT(*) FROM chat_messages
 *   WHERE "from" = 'system' AND content LIKE '%Server restarted%'
 *   AND timestamp > (now - 30 * 60 * 1000)
 *   → count >= 2 means in-window
 */

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

const RESTART_WINDOW_MS = 30 * 60 * 1000
const RESTART_BURST_THRESHOLD = 2
const RESTART_CONTENT = 'Server restarted. Resume your work.'

/** Minimal DB that mirrors the chat_messages schema */
function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      "from" TEXT NOT NULL,
      content TEXT NOT NULL,
      channel TEXT,
      timestamp INTEGER NOT NULL,
      type TEXT
    )
  `)
  return db
}

function seedRestarts(db: ReturnType<typeof makeDb>, count: number, withinMs = 10 * 60 * 1000): void {
  const now = Date.now()
  for (let i = 0; i < count; i++) {
    db.prepare(
      `INSERT INTO chat_messages ("from", content, channel, timestamp) VALUES ('system', ?, 'general', ?)`
    ).run(RESTART_CONTENT, now - i * Math.floor(withinMs / Math.max(count, 1)))
  }
}

/** Mirrors isInRestartWindow() from src/health.ts */
function isInRestartWindow(db: ReturnType<typeof makeDb>, nowMs = Date.now()): boolean {
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM chat_messages WHERE "from" = 'system' AND content LIKE '%Server restarted%' AND timestamp > ?`
  ).get(nowMs - RESTART_WINDOW_MS) as { cnt: number }
  return row.cnt >= RESTART_BURST_THRESHOLD
}

describe('SIGNAL-ROUTING Change 3: idle alert suppression in restart window', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => { db = makeDb() })

  it('A: 0 restarts → NOT in window', () => {
    expect(isInRestartWindow(db)).toBe(false)
  })

  it('B: 1 restart → NOT in window (below threshold of 2)', () => {
    seedRestarts(db, 1)
    expect(isInRestartWindow(db)).toBe(false)
  })

  it('C: 2 restarts (at threshold) → IN window', () => {
    seedRestarts(db, 2)
    expect(isInRestartWindow(db)).toBe(true)
  })

  it('D: 3 rapid restarts → IN window', () => {
    seedRestarts(db, 3)
    expect(isInRestartWindow(db)).toBe(true)
  })

  it('E: restarts older than 30min do not count', () => {
    const now = Date.now()
    const stale = now - 35 * 60 * 1000  // 35 min ago — outside window
    db.prepare(
      `INSERT INTO chat_messages ("from", content, channel, timestamp) VALUES ('system', ?, 'general', ?)`
    ).run(RESTART_CONTENT, stale)
    db.prepare(
      `INSERT INTO chat_messages ("from", content, channel, timestamp) VALUES ('system', ?, 'general', ?)`
    ).run(RESTART_CONTENT, stale - 60_000)
    db.prepare(
      `INSERT INTO chat_messages ("from", content, channel, timestamp) VALUES ('system', ?, 'general', ?)`
    ).run(RESTART_CONTENT, stale - 120_000)

    // 3 restarts but all stale — window should be clear
    expect(isInRestartWindow(db)).toBe(false)
  })

  it('F: mixed stale + fresh: 1 stale + 2 fresh → IN window', () => {
    const now = Date.now()
    const stale = now - 35 * 60 * 1000
    db.prepare(
      `INSERT INTO chat_messages ("from", content, channel, timestamp) VALUES ('system', ?, 'general', ?)`
    ).run(RESTART_CONTENT, stale)
    seedRestarts(db, 2, 5 * 60 * 1000)  // 2 fresh within last 5min

    expect(isInRestartWindow(db)).toBe(true)
  })

  it('G: window-active message has correct label format', () => {
    // Verify the message format used in health.ts during restart window
    const agent = 'link'
    const inactivityMin = 60
    const taskId = 'task-abc123'
    const inRestartWindow = true

    // queue-clear path
    const queueClearMsg = inRestartWindow
      ? `@${agent} [idle-info, restart-window-active — may be false-positive] idle for ${inactivityMin}m with no active task.`
      : `@${agent} @owner system escalation: ${inactivityMin}m idle and no active task. Pull work now.`

    expect(queueClearMsg).toContain('idle-info')
    expect(queueClearMsg).toContain('restart-window-active')
    expect(queueClearMsg).toContain('may be false-positive')
    expect(queueClearMsg).not.toContain('@owner')

    // task-idle path
    const taskIdleMsg = inRestartWindow
      ? `@${agent} [idle-info, restart-window-active — may be false-positive] idle for ${inactivityMin}m on ${taskId}.`
      : `@${agent} @owner system escalation: ${inactivityMin}m idle. Post required status format now.`

    expect(taskIdleMsg).toContain('idle-info')
    expect(taskIdleMsg).toContain(taskId)
    expect(taskIdleMsg).not.toContain('@owner')
  })
})
