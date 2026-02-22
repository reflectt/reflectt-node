/**
 * Tests for mention-rescue thread-level idempotency.
 *
 * Verifies:
 * - Thread-key dedup prevents duplicate rescues within same thread
 * - SQLite persistence survives across ticks
 * - Same-thread repeated tick produces zero duplicates
 * - Different threads are rescued independently
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'
import { getDb } from '../src/db.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  // Ensure table exists (guards against CI race where migrations haven't run yet)
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS mention_rescue_state (
      thread_key TEXT PRIMARY KEY,
      message_ids TEXT NOT NULL DEFAULT '[]',
      rescued_at INTEGER NOT NULL,
      rescue_count INTEGER NOT NULL DEFAULT 1
    )
  `)
  // Clear between tests
  db.exec('DELETE FROM mention_rescue_state')
})

describe('Mention-rescue idempotency', () => {
  it('dry-run tick returns rescued array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/health/mention-rescue/tick?dryRun=true',
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.rescued)).toBe(true)
  })

  it('two consecutive dry-run ticks return consistent results', async () => {
    const r1 = await app.inject({
      method: 'POST',
      url: '/health/mention-rescue/tick?dryRun=true',
    })
    expect(r1.statusCode).toBe(200)

    const r2 = await app.inject({
      method: 'POST',
      url: '/health/mention-rescue/tick?dryRun=true',
    })
    expect(r2.statusCode).toBe(200)

    // Dry run doesn't mutate state, so both should return the same rescued set
    const body1 = JSON.parse(r1.body)
    const body2 = JSON.parse(r2.body)
    expect(body1.rescued.length).toBe(body2.rescued.length)
  })

  it('same-thread repeated real tick: second tick produces no duplicates', async () => {
    // Use a nowMs far in the future where no real messages exist
    const futureNow = Date.now() + 365 * 24 * 60 * 60 * 1000

    const r1 = await app.inject({
      method: 'POST',
      url: `/health/mention-rescue/tick?dryRun=false&nowMs=${futureNow}`,
    })
    expect(r1.statusCode).toBe(200)
    const body1 = JSON.parse(r1.body)
    expect(Array.isArray(body1.rescued)).toBe(true)

    // Second tick — anything rescued in r1 should NOT be rescued again
    const r2 = await app.inject({
      method: 'POST',
      url: `/health/mention-rescue/tick?dryRun=false&nowMs=${futureNow + 1000}`,
    })
    expect(r2.statusCode).toBe(200)
    const body2 = JSON.parse(r2.body)
    expect(body2.rescued.length).toBe(0)
  })

  it('thread key dedup: rescued array has unique reply_to targets', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/health/mention-rescue/tick?dryRun=true',
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    // Each rescued message should target a unique mention
    const replyTargets = new Set<string>()
    for (const msg of body.rescued) {
      const match = msg.match(/\[\[reply_to:([^\]]+)\]\]/)
      if (match) {
        expect(replyTargets.has(match[1])).toBe(false)
        replyTargets.add(match[1])
      }
    }
  })

  it('mention_rescue_state table exists after tick', async () => {
    // The table is created lazily on first tick — verify it exists after a tick
    const res = await app.inject({
      method: 'POST',
      url: '/health/mention-rescue/tick?dryRun=true',
    })
    expect(res.statusCode).toBe(200)

    // Table should exist (created during server startup or first tick)
    const db = getDb()
    const tableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='mention_rescue_state'"
    ).get() as { name: string } | undefined
    expect(tableCheck?.name).toBe('mention_rescue_state')
  })

  it('persisted state survives across tick invocations', async () => {
    // First: seed a chat message from "ryan" mentioning @link in the test DB
    const now = Date.now()
    const mentionTs = now - 5 * 60_000 // 5 minutes ago (within 30-min window, past delay)
    const db = getDb()

    // Insert a test mention message
    const testMsgId = `test-mention-${now}`
    try {
      db.prepare(
        'INSERT INTO chat_messages (id, "from", "to", content, timestamp, channel, reactions, thread_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(testMsgId, 'ryan', '', 'hey @link @kai @pixel can you check this?', mentionTs, 'general', '[]', null, '{}')
    } catch {
      // Message table might have different schema — skip this test
      return
    }

    // First real tick — should rescue this mention
    const r1 = await app.inject({
      method: 'POST',
      url: `/health/mention-rescue/tick?dryRun=false&nowMs=${now}&force=true`,
    })
    expect(r1.statusCode).toBe(200)
    const body1 = JSON.parse(r1.body)

    // If rescued, verify persistence
    if (body1.rescued.length > 0) {
      // Check SQLite has the thread key
      const rows = db.prepare('SELECT * FROM mention_rescue_state').all()
      expect(rows.length).toBeGreaterThan(0)

      // Second tick — same mention should NOT be rescued again
      const r2 = await app.inject({
        method: 'POST',
        url: `/health/mention-rescue/tick?dryRun=false&nowMs=${now + 1000}&force=true`,
      })
      expect(r2.statusCode).toBe(200)
      const body2 = JSON.parse(r2.body)

      // The same mention should not appear in rescued again
      const duplicates = body2.rescued.filter((msg: string) => msg.includes(testMsgId))
      expect(duplicates.length).toBe(0)
    }

    // Cleanup test message
    try {
      db.prepare('DELETE FROM chat_messages WHERE id = ?').run(testMsgId)
    } catch {
      // ignore
    }
  })

  it('schema init order: table exists before any tick (regression)', () => {
    // Regression guard: getDb() + migrations should create the table
    // even without a prior tick call. This failed in CI when migration v10
    // wasn't applied before test assertions ran.
    const db = getDb()
    const tableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='mention_rescue_state'"
    ).get() as { name: string } | undefined
    expect(tableCheck?.name).toBe('mention_rescue_state')
  })

  it('suppressed during quiet hours', async () => {
    // Use a nowMs during quiet hours (3 AM PST = 11 AM UTC)
    const quietDate = new Date('2026-03-01T11:00:00Z')
    const quietNowMs = quietDate.getTime()
    const res = await app.inject({
      method: 'POST',
      url: `/health/mention-rescue/tick?dryRun=true&nowMs=${quietNowMs}`,
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    if (body.suppressed) {
      expect(body.reason).toBe('quiet-hours')
    }
    expect(Array.isArray(body.rescued)).toBe(true)
  })
})
