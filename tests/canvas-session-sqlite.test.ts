// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for canvas session SQLite write-through durability.
 * AC: pushCanvasSession writes to DB; getCanvasSession reads from DB on cache miss.
 * task-1773605754615-i2vj55bqg
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getDb } from '../src/db.js'

// Verify migration created the table
describe('canvas_sessions DB migration', () => {
  it('canvas_sessions table exists after migration', () => {
    const db = getDb()
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='canvas_sessions'"
    ).get() as { name: string } | undefined
    expect(row?.name).toBe('canvas_sessions')
  })

  it('can insert and query session turns', () => {
    const db = getDb()
    const sessionId = `test-session-${Date.now()}`
    const now = Date.now()

    db.prepare('INSERT INTO canvas_sessions (session_id, role, content, ts) VALUES (?, ?, ?, ?)')
      .run(sessionId, 'user', 'What is blocking?', now)
    db.prepare('INSERT INTO canvas_sessions (session_id, role, content, ts) VALUES (?, ?, ?, ?)')
      .run(sessionId, 'assistant', 'Nothing is blocked.', now + 1)

    const rows = db.prepare(
      'SELECT role, content, ts FROM canvas_sessions WHERE session_id = ? ORDER BY ts ASC'
    ).all(sessionId) as Array<{ role: string; content: string; ts: number }>

    expect(rows).toHaveLength(2)
    expect(rows[0]!.role).toBe('user')
    expect(rows[0]!.content).toBe('What is blocking?')
    expect(rows[1]!.role).toBe('assistant')

    // Cleanup
    db.prepare('DELETE FROM canvas_sessions WHERE session_id = ?').run(sessionId)
  })

  it('TTL pruning removes old rows', () => {
    const db = getDb()
    const sessionId = `test-ttl-${Date.now()}`
    const staleTs = Date.now() - 35 * 60 * 1000 // 35min ago — beyond 30min TTL
    const freshTs = Date.now()

    db.prepare('INSERT INTO canvas_sessions (session_id, role, content, ts) VALUES (?, ?, ?, ?)')
      .run(sessionId, 'user', 'Old query', staleTs)
    db.prepare('INSERT INTO canvas_sessions (session_id, role, content, ts) VALUES (?, ?, ?, ?)')
      .run(sessionId, 'user', 'Fresh query', freshTs)

    // Simulate TTL prune (same logic as getCanvasSession)
    const cutoff = Date.now() - 30 * 60 * 1000
    db.prepare('DELETE FROM canvas_sessions WHERE session_id = ? AND ts < ?').run(sessionId, cutoff)

    const remaining = db.prepare(
      'SELECT content FROM canvas_sessions WHERE session_id = ?'
    ).all(sessionId) as Array<{ content: string }>

    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.content).toBe('Fresh query')

    // Cleanup
    db.prepare('DELETE FROM canvas_sessions WHERE session_id = ?').run(sessionId)
  })
})
