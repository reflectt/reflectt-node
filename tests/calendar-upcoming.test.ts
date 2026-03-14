// Tests for calendar agent execution surface
// GET /calendar/upcoming, POST /calendar/events (spec format), DELETE /calendar/events/:id
//
// Task: task-1773516610408-w3fsz0cgj

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import Fastify from 'fastify'

let app: ReturnType<typeof Fastify>

beforeAll(async () => {
  const { createServer } = await import('../src/server.js')
  app = await createServer()
})

beforeEach(async () => {
  // Clear any events created in tests by deleting all upcoming events
  const listRes = await app.inject({ method: 'GET', url: '/calendar/events?limit=200' })
  if (listRes.statusCode === 200) {
    const body = JSON.parse(listRes.body)
    for (const evt of body.events ?? []) {
      await app.inject({ method: 'DELETE', url: `/calendar/events/${evt.id}` })
    }
  }
})

// ── Helpers ────────────────────────────────────────────────────────────────

function futureIso(offsetMs = 24 * 60 * 60 * 1000): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

describe('GET /calendar/upcoming', () => {
  it('returns empty events array when no events exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/calendar/upcoming' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.events)).toBe(true)
  })

  it('returns events within the next 7 days by default', async () => {
    // Create an event tomorrow
    const tomorrow = futureIso(24 * 60 * 60 * 1000)
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: { title: 'Standup', start: tomorrow, duration_minutes: 30 },
    })

    const res = await app.inject({ method: 'GET', url: '/calendar/upcoming' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.events.some((e: { title: string }) => e.title === 'Standup')).toBe(true)
  })

  it('respects ?days param', async () => {
    const in10days = futureIso(10 * 24 * 60 * 60 * 1000)
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: { title: 'Far Future Event', start: in10days, duration_minutes: 60 },
    })

    // ?days=7 should not include it
    const short = await app.inject({ method: 'GET', url: '/calendar/upcoming?days=7' })
    const shortBody = JSON.parse(short.body)
    expect(shortBody.events.some((e: { title: string }) => e.title === 'Far Future Event')).toBe(false)

    // ?days=14 should include it
    const long = await app.inject({ method: 'GET', url: '/calendar/upcoming?days=14' })
    const longBody = JSON.parse(long.body)
    expect(longBody.events.some((e: { title: string }) => e.title === 'Far Future Event')).toBe(true)
  })

  it('response shape matches spec (id, title, start, end, attendees, provider)', async () => {
    const start = futureIso(2 * 60 * 60 * 1000)
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: {
        title: 'Shape Test',
        start,
        duration_minutes: 45,
        attendees: ['ryan@example.com'],
        calendar: 'Work',
      },
    })

    const res = await app.inject({ method: 'GET', url: '/calendar/upcoming' })
    const body = JSON.parse(res.body)
    const evt = body.events.find((e: { title: string }) => e.title === 'Shape Test')
    expect(evt).toBeDefined()
    expect(evt.id).toBeDefined()
    expect(evt.start).toBeDefined()
    expect(evt.end).toBeDefined()
    expect(Array.isArray(evt.attendees)).toBe(true)
    expect(evt.provider).toBe('local')
  })
})

describe('POST /calendar/events (spec format)', () => {
  it('creates an event and returns 201 with spec shape', async () => {
    const start = futureIso()
    const res = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: {
        title: '1:1 with Ryan',
        start,
        duration_minutes: 30,
        attendees: ['ryan@example.com'],
        calendar: 'Work',
        description: 'Weekly sync',
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.id).toBeDefined()
    expect(body.title).toBe('1:1 with Ryan')
    expect(body.start).toBeDefined()
    expect(body.end).toBeDefined()
  })

  it('defaults duration_minutes to 60 when omitted', async () => {
    const start = futureIso(4 * 60 * 60 * 1000)
    const res = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: { title: 'Long Meeting', start },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    const durationMs = Date.parse(body.end) - Date.parse(body.start)
    expect(durationMs).toBe(60 * 60 * 1000)
  })

  it('returns 422 for past start time', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const res = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: { title: 'Past Event', start: past },
    })
    expect(res.statusCode).toBe(422)
    const body = JSON.parse(res.body)
    expect(body.code).toBe('PAST_DATE')
  })

  it('returns 409 for exact duplicate (same title + start)', async () => {
    const start = futureIso(6 * 60 * 60 * 1000)
    const payload = { title: 'Duplicate Meeting', start, duration_minutes: 30 }

    const first = await app.inject({ method: 'POST', url: '/calendar/events', payload })
    expect(first.statusCode).toBe(201)

    const second = await app.inject({ method: 'POST', url: '/calendar/events', payload })
    expect(second.statusCode).toBe(409)
    const body = JSON.parse(second.body)
    expect(body.error).toMatch(/[Dd]uplicate/)
  })

  it('returns 400 when title is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: { start: futureIso() },
    })
    expect(res.statusCode).toBe(400)
  })

  it('created event appears in GET /calendar/upcoming', async () => {
    const start = futureIso(3 * 60 * 60 * 1000)
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: { title: 'Visible Event', start },
    })
    const upcoming = await app.inject({ method: 'GET', url: '/calendar/upcoming' })
    const body = JSON.parse(upcoming.body)
    expect(body.events.some((e: { title: string }) => e.title === 'Visible Event')).toBe(true)
  })
})

describe('DELETE /calendar/events/:id', () => {
  it('deletes an existing event and returns 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: { title: 'To Delete', start: futureIso(5 * 60 * 60 * 1000) },
    })
    const { id } = JSON.parse(res.body)

    const del = await app.inject({ method: 'DELETE', url: `/calendar/events/${id}` })
    expect(del.statusCode).toBe(200)
    expect(JSON.parse(del.body).success).toBe(true)
  })

  it('returns 404 when event does not exist', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/calendar/events/nonexistent-id' })
    expect(res.statusCode).toBe(404)
  })
})
