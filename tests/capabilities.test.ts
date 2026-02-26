/**
 * Tests for GET /capabilities — agent-facing endpoint discovery.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('GET /capabilities', () => {
  it('returns 200 with version and api_version', async () => {
    const res = await app.inject({ method: 'GET', url: '/capabilities' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.version).toBeDefined()
    expect(typeof body.version).toBe('string')
    expect(body.api_version).toBeDefined()
  })

  it('includes generated_at timestamp', async () => {
    const before = Date.now()
    const res = await app.inject({ method: 'GET', url: '/capabilities' })
    const after = Date.now()
    const body = JSON.parse(res.body)
    expect(body.generated_at).toBeGreaterThanOrEqual(before)
    expect(body.generated_at).toBeLessThanOrEqual(after)
  })

  it('lists all major endpoint groups', async () => {
    const res = await app.inject({ method: 'GET', url: '/capabilities' })
    const body = JSON.parse(res.body)
    expect(body.endpoints).toBeDefined()
    expect(body.endpoints.tasks).toBeDefined()
    expect(body.endpoints.chat).toBeDefined()
    expect(body.endpoints.inbox).toBeDefined()
    expect(body.endpoints.insights).toBeDefined()
    expect(body.endpoints.reflections).toBeDefined()
    expect(body.endpoints.bootstrap).toBeDefined()
    expect(body.endpoints.system).toBeDefined()
  })

  it('each endpoint entry has method and path', async () => {
    const res = await app.inject({ method: 'GET', url: '/capabilities' })
    const body = JSON.parse(res.body)
    for (const [_group, entries] of Object.entries(body.endpoints)) {
      for (const [_name, entry] of Object.entries(entries as Record<string, any>)) {
        expect(entry.method).toBeDefined()
        expect(entry.path).toBeDefined()
        expect(typeof entry.method).toBe('string')
        expect(typeof entry.path).toBe('string')
      }
    }
  })

  it('marks compact-capable endpoints', async () => {
    const res = await app.inject({ method: 'GET', url: '/capabilities' })
    const body = JSON.parse(res.body)
    // These endpoints support compact mode
    expect(body.endpoints.tasks.list.compact).toBe(true)
    expect(body.endpoints.tasks.get.compact).toBe(true)
    expect(body.endpoints.tasks.active.compact).toBe(true)
    expect(body.endpoints.tasks.next.compact).toBe(true)
    expect(body.endpoints.tasks.search.compact).toBe(true)
    expect(body.endpoints.chat.messages.compact).toBe(true)
    expect(body.endpoints.inbox.get.compact).toBe(true)
    // These do not
    expect(body.endpoints.tasks.create.compact).toBeUndefined()
    expect(body.endpoints.chat.send.compact).toBeUndefined()
  })

  it('includes usage recommendations', async () => {
    const res = await app.inject({ method: 'GET', url: '/capabilities' })
    const body = JSON.parse(res.body)
    expect(body.recommendations).toBeDefined()
    expect(Array.isArray(body.recommendations)).toBe(true)
    expect(body.recommendations.length).toBeGreaterThan(0)
    // Should mention compact
    expect(body.recommendations.some((r: string) => r.includes('compact'))).toBe(true)
  })

  it('includes bootstrap heartbeat endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/capabilities' })
    const body = JSON.parse(res.body)
    expect(body.endpoints.bootstrap.heartbeat.path).toBe('/bootstrap/heartbeat/:agent')
  })
})
