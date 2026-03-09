/**
 * Tests for the schedule feed — team-wide time-awareness primitives.
 *
 * MVP scope: deploy windows, focus blocks, scheduled tasks.
 * Feed returns upcoming entries in chronological order.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import Fastify from 'fastify'
import {
  createScheduleEntry,
  getScheduleEntry,
  updateScheduleEntry,
  deleteScheduleEntry,
  getScheduleFeed,
  _resetScheduleStore,
} from '../src/schedule.js'

let app: ReturnType<typeof Fastify>

beforeAll(async () => {
  const { createServer } = await import('../src/server.js')
  app = await createServer()
})

beforeEach(() => {
  _resetScheduleStore()
})

const NOW = Date.now()
const HOUR = 3_600_000

describe('createScheduleEntry', () => {
  it('creates a deploy_window', () => {
    const entry = createScheduleEntry({
      kind: 'deploy_window',
      title: 'Deploy window: v1.2',
      start: NOW + HOUR,
      end: NOW + 2 * HOUR,
      owner: 'kai',
    })
    expect(entry.id).toMatch(/^dw-/)
    expect(entry.kind).toBe('deploy_window')
    expect(entry.status).toBe('open')
    expect(entry.task_id).toBeNull()
  })

  it('creates a focus_block', () => {
    const entry = createScheduleEntry({
      kind: 'focus_block',
      title: 'Team focus: no interruptions',
      start: NOW + HOUR,
      end: NOW + 3 * HOUR,
      owner: 'system',
      status: 'active',
    })
    expect(entry.id).toMatch(/^fb-/)
    expect(entry.status).toBe('active')
  })

  it('creates a scheduled_task', () => {
    const entry = createScheduleEntry({
      kind: 'scheduled_task',
      title: 'DB migration window',
      start: NOW + 2 * HOUR,
      end: NOW + 4 * HOUR,
      owner: 'link',
      task_id: 'task-123',
      meta: { risk: 'high' },
    })
    expect(entry.id).toMatch(/^st-/)
    expect(entry.task_id).toBe('task-123')
    expect(entry.meta).toBe(JSON.stringify({ risk: 'high' }))
  })

  it('rejects invalid kind', () => {
    expect(() => createScheduleEntry({
      kind: 'invalid' as any,
      title: 'x',
      start: NOW,
      end: NOW + HOUR,
      owner: 'test',
    })).toThrow('kind must be')
  })

  it('rejects end before start', () => {
    expect(() => createScheduleEntry({
      kind: 'deploy_window',
      title: 'Bad window',
      start: NOW + HOUR,
      end: NOW,
      owner: 'test',
    })).toThrow('end must be after start')
  })

  it('rejects missing owner', () => {
    expect(() => createScheduleEntry({
      kind: 'focus_block',
      title: 'Block',
      start: NOW,
      end: NOW + HOUR,
      owner: '',
    })).toThrow('owner is required')
  })
})

describe('getScheduleFeed', () => {
  it('returns upcoming entries in chronological order', () => {
    createScheduleEntry({ kind: 'deploy_window', title: 'Window 2', start: NOW + 3 * HOUR, end: NOW + 4 * HOUR, owner: 'kai' })
    createScheduleEntry({ kind: 'focus_block', title: 'Block 1', start: NOW + HOUR, end: NOW + 2 * HOUR, owner: 'system' })
    createScheduleEntry({ kind: 'scheduled_task', title: 'Task 3', start: NOW + 5 * HOUR, end: NOW + 6 * HOUR, owner: 'link' })

    const feed = getScheduleFeed({ after: NOW })
    expect(feed.length).toBe(3)
    expect(feed[0].title).toBe('Block 1')
    expect(feed[1].title).toBe('Window 2')
    expect(feed[2].title).toBe('Task 3')
  })

  it('filters by kind', () => {
    createScheduleEntry({ kind: 'deploy_window', title: 'DW', start: NOW + HOUR, end: NOW + 2 * HOUR, owner: 'kai' })
    createScheduleEntry({ kind: 'focus_block', title: 'FB', start: NOW + HOUR, end: NOW + 2 * HOUR, owner: 'system' })

    const feed = getScheduleFeed({ kinds: ['deploy_window'] })
    expect(feed.length).toBe(1)
    expect(feed[0].kind).toBe('deploy_window')
  })

  it('filters by owner', () => {
    createScheduleEntry({ kind: 'deploy_window', title: 'A', start: NOW + HOUR, end: NOW + 2 * HOUR, owner: 'kai' })
    createScheduleEntry({ kind: 'focus_block', title: 'B', start: NOW + HOUR, end: NOW + 2 * HOUR, owner: 'link' })

    expect(getScheduleFeed({ owner: 'kai' }).length).toBe(1)
    expect(getScheduleFeed({ owner: 'link' }).length).toBe(1)
  })

  it('excludes past entries by default', () => {
    createScheduleEntry({ kind: 'deploy_window', title: 'Past', start: NOW - 3 * HOUR, end: NOW - HOUR, owner: 'kai' })
    createScheduleEntry({ kind: 'deploy_window', title: 'Future', start: NOW + HOUR, end: NOW + 2 * HOUR, owner: 'kai' })

    const feed = getScheduleFeed()
    expect(feed.length).toBe(1)
    expect(feed[0].title).toBe('Future')
  })
})

describe('updateScheduleEntry', () => {
  it('updates title and status', () => {
    const entry = createScheduleEntry({ kind: 'deploy_window', title: 'Old title', start: NOW + HOUR, end: NOW + 2 * HOUR, owner: 'kai' })
    const updated = updateScheduleEntry(entry.id, { title: 'New title', status: 'closed' })
    expect(updated?.title).toBe('New title')
    expect(updated?.status).toBe('closed')
  })

  it('returns null for missing id', () => {
    expect(updateScheduleEntry('nonexistent', { title: 'x' })).toBeNull()
  })
})

describe('deleteScheduleEntry', () => {
  it('deletes an entry', () => {
    const entry = createScheduleEntry({ kind: 'focus_block', title: 'Block', start: NOW + HOUR, end: NOW + 2 * HOUR, owner: 'system' })
    expect(deleteScheduleEntry(entry.id)).toBe(true)
    expect(getScheduleEntry(entry.id)).toBeNull()
  })

  it('returns false for missing id', () => {
    expect(deleteScheduleEntry('nonexistent')).toBe(false)
  })
})

describe('GET /schedule/feed', () => {
  it('returns empty feed when no entries', async () => {
    const res = await app.inject({ method: 'GET', url: '/schedule/feed' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.entries)).toBe(true)
    expect(body.count).toBe(0)
  })

  it('returns entries via API', async () => {
    createScheduleEntry({ kind: 'deploy_window', title: 'Test Window', start: NOW + HOUR, end: NOW + 2 * HOUR, owner: 'kai' })

    const res = await app.inject({ method: 'GET', url: '/schedule/feed' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.count).toBe(1)
    expect(body.entries[0].title).toBe('Test Window')
  })

  it('filters by kind via query param', async () => {
    createScheduleEntry({ kind: 'deploy_window', title: 'DW', start: NOW + HOUR, end: NOW + 2 * HOUR, owner: 'kai' })
    createScheduleEntry({ kind: 'focus_block', title: 'FB', start: NOW + HOUR, end: NOW + 2 * HOUR, owner: 'system' })

    const res = await app.inject({ method: 'GET', url: '/schedule/feed?kinds=deploy_window' })
    const body = JSON.parse(res.body)
    expect(body.count).toBe(1)
    expect(body.entries[0].kind).toBe('deploy_window')
  })
})

describe('POST /schedule/entries', () => {
  it('creates a new schedule entry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/schedule/entries',
      payload: {
        kind: 'scheduled_task',
        title: 'DB migration',
        start: NOW + HOUR,
        end: NOW + 2 * HOUR,
        owner: 'link',
        task_id: 'task-abc',
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.entry.kind).toBe('scheduled_task')
    expect(body.entry.task_id).toBe('task-abc')
  })

  it('returns 400 for invalid input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/schedule/entries',
      payload: { kind: 'deploy_window', title: 'x', start: NOW + 2 * HOUR, end: NOW + HOUR, owner: 'kai' },
    })
    expect(res.statusCode).toBe(400)
  })
})
