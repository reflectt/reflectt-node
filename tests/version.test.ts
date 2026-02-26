/**
 * Tests for GET /version — version info with update availability check.
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

describe('GET /version', () => {
  it('returns current version from package.json', async () => {
    const res = await app.inject({ method: 'GET', url: '/version' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.current).toBeDefined()
    expect(typeof body.current).toBe('string')
    expect(body.current).not.toBe('0.0.0') // Should read from package.json
  })

  it('includes commit hash', async () => {
    const res = await app.inject({ method: 'GET', url: '/version' })
    const body = JSON.parse(res.body)
    expect(body.commit).toBeDefined()
    expect(typeof body.commit).toBe('string')
  })

  it('includes latest field', async () => {
    const res = await app.inject({ method: 'GET', url: '/version' })
    const body = JSON.parse(res.body)
    // May be 'unknown' if no releases published yet, or a version string
    expect(body.latest).toBeDefined()
  })

  it('includes update_available boolean', async () => {
    const res = await app.inject({ method: 'GET', url: '/version' })
    const body = JSON.parse(res.body)
    expect(typeof body.update_available).toBe('boolean')
  })

  it('includes checked_at timestamp', async () => {
    const res = await app.inject({ method: 'GET', url: '/version' })
    const body = JSON.parse(res.body)
    expect(body.checked_at).toBeDefined()
    expect(typeof body.checked_at).toBe('number')
    expect(body.checked_at).toBeGreaterThan(0)
  })

  it('includes uptime_seconds', async () => {
    const res = await app.inject({ method: 'GET', url: '/version' })
    const body = JSON.parse(res.body)
    expect(typeof body.uptime_seconds).toBe('number')
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0)
  })

  it('caches GitHub check (second call is fast)', async () => {
    // First call triggers fetch
    await app.inject({ method: 'GET', url: '/version' })
    // Second call should use cache
    const start = Date.now()
    const res = await app.inject({ method: 'GET', url: '/version' })
    const elapsed = Date.now() - start
    expect(res.statusCode).toBe(200)
    // Cached call should be fast (under 100ms)
    expect(elapsed).toBeLessThan(100)
  })
})

describe('GET /health includes version', () => {
  it('returns version field', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.version).toBeDefined()
    expect(typeof body.version).toBe('string')
    expect(body.version).not.toBe('0.0.0')
  })

  it('returns commit field', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    const body = JSON.parse(res.body)
    expect(body.commit).toBeDefined()
  })
})
