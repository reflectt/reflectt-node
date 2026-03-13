import { describe, it, expect, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'

describe('GET /agents/:agent/timeline', () => {
  let app: Awaited<ReturnType<typeof createServer>>

  beforeEach(async () => {
    app = await createServer({ logger: false })
    await app.ready()
  })

  it('returns 200 with timeline array + count', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/link/timeline' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('agent', 'link')
    expect(body).toHaveProperty('timeline')
    expect(body).toHaveProperty('count')
    expect(Array.isArray(body.timeline)).toBe(true)
    expect(typeof body.count).toBe('number')
  })

  it('each event has type, timestamp, summary', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/link/timeline' })
    const body = JSON.parse(res.body)
    for (const event of body.timeline) {
      expect(['run_complete', 'task_state_change', 'trust_event']).toContain(event.type)
      expect(typeof event.timestamp).toBe('number')
      expect(typeof event.summary).toBe('string')
    }
  })

  it('supports ?limit= param', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/link/timeline?limit=5' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.timeline.length).toBeLessThanOrEqual(5)
  })

  it('supports ?since= param (filters by timestamp)', async () => {
    const futureTs = Date.now() + 1_000_000_000
    const res = await app.inject({ method: 'GET', url: `/agents/link/timeline?since=${futureTs}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    // No events after a far-future timestamp
    expect(body.timeline.length).toBe(0)
  })

  it('returns events in reverse-chronological order', async () => {
    // Create a task + comment to seed at least one event
    const task = await app.inject({
      method: 'POST', url: '/tasks',
      payload: { title: 'timeline order test', assignee: 'link', actor: 'kai' },
    })
    const taskBody = JSON.parse(task.body)
    if (taskBody.task) {
      await app.inject({
        method: 'POST', url: `/tasks/${taskBody.task.id}/comments`,
        payload: { content: '[transition] doing → validating', author: 'kai', category: 'status_change' },
      })
    }

    const res = await app.inject({ method: 'GET', url: '/agents/link/timeline' })
    const body = JSON.parse(res.body)
    const timestamps = body.timeline.map((e: any) => e.timestamp)
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeLessThanOrEqual(timestamps[i - 1])
    }
  })

  it('caps at limit=200 even if more requested', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/link/timeline?limit=999' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.timeline.length).toBeLessThanOrEqual(200)
  })
})
