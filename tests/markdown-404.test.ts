/**
 * Tests for markdown 404 error responses with endpoint discovery.
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

describe('Markdown 404 responses', () => {
  it('returns markdown for unknown GET endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/nonexistent' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('text/markdown')
    expect(res.body).toContain('# 404')
    expect(res.body).toContain('`GET /nonexistent`')
  })

  it('returns markdown for unknown POST endpoint', async () => {
    const res = await app.inject({ method: 'POST', url: '/does-not-exist' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('text/markdown')
    expect(res.body).toContain('`POST /does-not-exist`')
  })

  it('includes version in the response', async () => {
    const res = await app.inject({ method: 'GET', url: '/nonexistent' })
    expect(res.body).toContain('reflectt-node v')
  })

  it('includes endpoint table with key routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nonexistent' })
    expect(res.body).toContain('/health')
    expect(res.body).toContain('/capabilities')
    expect(res.body).toContain('/tasks')
    expect(res.body).toContain('/inbox/:agent')
    expect(res.body).toContain('/chat/messages')
    expect(res.body).toContain('/bootstrap/heartbeat/:agent')
  })

  it('points to /capabilities for full listing', async () => {
    const res = await app.inject({ method: 'GET', url: '/nonexistent' })
    expect(res.body).toContain('`GET /capabilities`')
  })

  it('strips query params from URL in heading', async () => {
    const res = await app.inject({ method: 'GET', url: '/nonexistent?foo=bar&baz=1' })
    expect(res.body).toContain('`GET /nonexistent`')
    expect(res.body).not.toContain('foo=bar')
  })

  it('existing endpoints still work normally', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('ok')
  })
})
