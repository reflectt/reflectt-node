// Tests for Activity Timeline endpoint + grouping engine
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'
import { getDb } from '../src/db.js'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('GET /activity', () => {
  it('returns valid ActivityResult shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/activity' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('events')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('next_cursor')
    expect(body).toHaveProperty('range')
    expect(body.range).toHaveProperty('from')
    expect(body.range).toHaveProperty('to')
    expect(body.range).toHaveProperty('tz')
    expect(Array.isArray(body.events)).toBe(true)
  })

  it('returns empty events for unknown agent', async () => {
    const res = await app.inject({ method: 'GET', url: '/activity?agent=nonexistent_agent_xyz' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.events).toEqual([])
    expect(body.total).toBe(0)
  })

  it('supports range=7d', async () => {
    const res = await app.inject({ method: 'GET', url: '/activity?range=7d' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    const from = new Date(body.range.from).getTime()
    const to = new Date(body.range.to).getTime()
    expect(to - from).toBeGreaterThan(6 * 24 * 60 * 60 * 1000)
  })

  it('supports type filter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/activity?type=chat.message',
      headers: { accept: 'application/json' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    for (const e of body.events) {
      expect(e.type).toBe('chat.message')
    }
  })

  it('supports limit', async () => {
    const res = await app.inject({ method: 'GET', url: '/activity?limit=2' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.events.length).toBeLessThanOrEqual(2)
  })

  it('supports cursor pagination via after', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/activity?limit=1' })
    const body1 = JSON.parse(res1.body)
    if (body1.next_cursor) {
      const res2 = await app.inject({ method: 'GET', url: `/activity?limit=1&after=${body1.next_cursor}` })
      const body2 = JSON.parse(res2.body)
      expect(body2.events.length).toBeLessThanOrEqual(1)
    }
  })

  it('after cursor is exclusive (page 2 does not repeat last event from page 1)', async () => {
    const db = getDb()
    const now = Date.now()
    const channel = `test-cursor-${now}`

    // Insert 2 chat messages with distinct timestamps so ordering is deterministic.
    db.prepare(`INSERT INTO chat_messages (id, "from", content, timestamp, channel) VALUES (?, ?, ?, ?, ?)`).run(
      `chat-cursor-${now}-1`, 'testbot', 'first', now - 1000, channel
    )
    db.prepare(`INSERT INTO chat_messages (id, "from", content, timestamp, channel) VALUES (?, ?, ?, ?, ?)`).run(
      `chat-cursor-${now}-2`, 'testbot', 'second', now - 2000, channel
    )

    try {
      const res1 = await app.inject({ method: 'GET', url: `/activity?type=chat&limit=1` })
      expect(res1.statusCode).toBe(200)
      const body1 = JSON.parse(res1.body)
      expect(body1.events.length).toBe(1)
      expect(body1.next_cursor).toBeTruthy()

      const firstId = body1.events[0].id

      const res2 = await app.inject({ method: 'GET', url: `/activity?type=chat&limit=1&after=${body1.next_cursor}` })
      expect(res2.statusCode).toBe(200)
      const body2 = JSON.parse(res2.body)
      if (body2.events.length > 0) {
        expect(body2.events[0].id).not.toBe(firstId)
      }
    } finally {
      db.prepare('DELETE FROM chat_messages WHERE id = ?').run(`chat-cursor-${now}-1`)
      db.prepare('DELETE FROM chat_messages WHERE id = ?').run(`chat-cursor-${now}-2`)
    }
  })

  it('events have required fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/activity?limit=5' })
    const body = JSON.parse(res.body)
    for (const e of body.events) {
      expect(e).toHaveProperty('id')
      expect(e).toHaveProperty('ts')
      expect(e).toHaveProperty('type')
      expect(e).toHaveProperty('summary')
      expect(typeof e.id).toBe('string')
      expect(typeof e.ts).toBe('string')
      expect(typeof e.type).toBe('string')
      expect(typeof e.summary).toBe('string')
    }
  })

  it('deterministic event IDs', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/activity?limit=3' })
    const res2 = await app.inject({ method: 'GET', url: '/activity?limit=3' })
    const ids1 = JSON.parse(res1.body).events.map((e: any) => e.id)
    const ids2 = JSON.parse(res2.body).events.map((e: any) => e.id)
    expect(ids1).toEqual(ids2)
  })
})

describe('chat burst grouping', () => {
  it('groups consecutive chat messages in same channel within 5min', async () => {
    const db = getDb()
    const now = Date.now()
    const channel = `test-burst-${now}`

    // Insert 5 chat messages within 1 minute in same channel
    for (let i = 0; i < 5; i++) {
      db.prepare(`INSERT INTO chat_messages (id, "from", content, timestamp, channel) VALUES (?, ?, ?, ?, ?)`)
        .run(`chat-burst-${now}-${i}`, 'testbot', `msg ${i}`, now - (4 - i) * 10000, channel)
    }

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/activity?type=chat&limit=100`,
        headers: { accept: 'application/json' },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)

      // Find grouped event for our test channel
      const grouped = body.events.find((e: any) =>
        (e.group?.kind === 'chat_burst' && e.summary?.includes(channel)) ||
        (e.type === 'chat.message_group' && e.summary?.includes(channel))
      )
      expect(grouped).toBeDefined()
      expect(grouped.group?.count || grouped.grouped_count).toBe(5)
      expect(grouped.summary).toContain('5 messages')
    } finally {
      // Cleanup
      for (let i = 0; i < 5; i++) {
        db.prepare('DELETE FROM chat_messages WHERE id = ?').run(`chat-burst-${now}-${i}`)
      }
    }
  })
})

describe('status churn grouping', () => {
  it('groups rapid task status changes within 10min', async () => {
    const db = getDb()
    const now = Date.now()
    const taskId = `task-churn-test-${now}`

    // Create task
    db.prepare(`INSERT INTO tasks (id, title, status, priority, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(taskId, 'Churn test', 'done', 'P2', 'test', now - 120000, now)

    // Insert 4 status changes within 2 minutes
    const transitions = [
      { from: 'todo', to: 'doing', offset: 120000 },
      { from: 'doing', to: 'validating', offset: 90000 },
      { from: 'validating', to: 'doing', offset: 60000 },
      { from: 'doing', to: 'done', offset: 30000 },
    ]
    for (let i = 0; i < transitions.length; i++) {
      db.prepare(`INSERT INTO task_history (id, task_id, type, actor, timestamp, data) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(`thevt-churn-${now}-${i}`, taskId, 'status_changed', 'testbot', now - transitions[i]!.offset,
          JSON.stringify({ from: transitions[i]!.from, to: transitions[i]!.to }))
    }

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/activity?type=task&limit=100',
        headers: { accept: 'application/json' },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)

      // Should be grouped into one event
      const grouped = body.events.find((e: any) =>
        (e.group?.kind === 'task_status_sequence' && e.group?.count === 4) ||
        (e.grouped_count === 4 && e.subject?.id === taskId)
      )
      expect(grouped).toBeDefined()
      expect(grouped.group?.count || grouped.grouped_count).toBe(4)
    } finally {
      // Cleanup
      for (let i = 0; i < transitions.length; i++) {
        db.prepare('DELETE FROM task_history WHERE id = ?').run(`thevt-churn-${now}-${i}`)
      }
      db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
    }
  })
})

describe('GET /activity/sources', () => {
  it('returns source list including reviews', async () => {
    const res = await app.inject({ method: 'GET', url: '/activity/sources' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.sources).toContain('tasks')
    expect(body.sources).toContain('reviews')
    expect(body.sources).toContain('chat')
    expect(body.sources).toContain('presence')
    expect(body.sources).toContain('reflections')
    expect(body.sources).toContain('insights')
  })
})

describe('event ID collision regression', () => {
  it('two chat messages in same channel same second produce distinct events', async () => {
    const db = getDb()
    const now = Date.now()
    const channel = `collision-test-${now}`
    const tsExact = now - 5000 // same exact millisecond

    db.prepare(`INSERT INTO chat_messages (id, "from", content, timestamp, channel) VALUES (?, ?, ?, ?, ?)`)
      .run(`msg-collision-a-${now}`, 'alice', 'first message', tsExact, channel)
    db.prepare(`INSERT INTO chat_messages (id, "from", content, timestamp, channel) VALUES (?, ?, ?, ?, ?)`)
      .run(`msg-collision-b-${now}`, 'bob', 'second message', tsExact, channel)

    try {
      const res = await app.inject({ method: 'GET', url: '/activity?type=chat&limit=200' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)

      // Both messages must appear (either as individual events or inside a group)
      const relevant = body.events.filter((e: any) =>
        e.summary?.includes(channel) ||
        e.group?.children?.some((c: any) => c.summary?.includes(channel))
      )

      // Count total child events (ungrouped or within groups)
      let totalMessages = 0
      for (const e of relevant) {
        if (e.group?.children) {
          totalMessages += e.group.children.filter((c: any) => c.summary?.includes(channel)).length
        } else {
          totalMessages += 1
        }
      }

      expect(totalMessages).toBeGreaterThanOrEqual(2)
    } finally {
      db.prepare('DELETE FROM chat_messages WHERE id = ?').run(`msg-collision-a-${now}`)
      db.prepare('DELETE FROM chat_messages WHERE id = ?').run(`msg-collision-b-${now}`)
    }
  })
})

describe('cursor pagination exclusivity', () => {
  it('last event of page 1 does not appear on page 2', async () => {
    const db = getDb()
    const now = Date.now()
    const channel = `cursor-test-${now}`

    // Insert 3 messages with distinct timestamps
    for (let i = 0; i < 3; i++) {
      db.prepare(`INSERT INTO chat_messages (id, "from", content, timestamp, channel) VALUES (?, ?, ?, ?, ?)`)
        .run(`msg-cursor-${now}-${i}`, 'testbot', `cursor msg ${i}`, now - (i + 1) * 60000, channel)
    }

    try {
      // Page 1: limit 2
      const res1 = await app.inject({ method: 'GET', url: `/activity?type=chat&limit=2` })
      expect(res1.statusCode).toBe(200)
      const page1 = JSON.parse(res1.body)

      if (page1.next_cursor) {
        // Page 2: use cursor
        const res2 = await app.inject({ method: 'GET', url: `/activity?type=chat&limit=2&after=${page1.next_cursor}` })
        expect(res2.statusCode).toBe(200)
        const page2 = JSON.parse(res2.body)

        // Collect all event IDs from both pages (including grouped children)
        const collectIds = (events: any[]) => {
          const ids: string[] = []
          for (const e of events) {
            ids.push(e.id)
            if (e.group?.children) {
              for (const c of e.group.children) ids.push(c.id)
            }
          }
          return ids
        }

        const page1Ids = new Set(collectIds(page1.events))
        const page2Ids = collectIds(page2.events)

        // No ID from page 2 should appear in page 1
        for (const id of page2Ids) {
          expect(page1Ids.has(id)).toBe(false)
        }
      }
    } finally {
      for (let i = 0; i < 3; i++) {
        db.prepare('DELETE FROM chat_messages WHERE id = ?').run(`msg-cursor-${now}-${i}`)
      }
    }
  })
})
