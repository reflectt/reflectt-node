/**
 * Cross-host insight ID resolution (task-1773518694305-x09i2t7o7)
 *
 * Validates that GET /loop/summary entries include host_id and host_api_url
 * so agents on BackOffice or EVI-Fly can resolve Mac Daddy insight IDs.
 *
 * Resolution pattern: GET {host_api_url}/insights/{insight_id}
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import Fastify from 'fastify'

let app: ReturnType<typeof Fastify>

beforeAll(async () => {
  const { createServer } = await import('../src/server.js')
  app = await createServer()
})

describe('loop/summary cross-host ID resolution', () => {
  it('A: each entry includes host_id field', async () => {
    const res = await app.inject({ method: 'GET', url: '/loop/summary?limit=5' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    // host_id present even when no insights exist (no entries = vacuously pass)
    for (const entry of body.entries) {
      expect(entry).toHaveProperty('host_id')
      expect(typeof entry.host_id).toBe('string')
      expect(entry.host_id.length).toBeGreaterThan(0)
    }
  })

  it('B: each entry includes host_api_url field as a valid URL-like string', async () => {
    const res = await app.inject({ method: 'GET', url: '/loop/summary?limit=5' })
    const body = JSON.parse(res.body)
    for (const entry of body.entries) {
      expect(entry).toHaveProperty('host_api_url')
      expect(typeof entry.host_api_url).toBe('string')
      // Must look like a URL (http:// or https://)
      expect(entry.host_api_url).toMatch(/^https?:\/\//)
    }
  })

  it('C: host_api_url does not have trailing slash (clean path concat)', async () => {
    const res = await app.inject({ method: 'GET', url: '/loop/summary?limit=5' })
    const body = JSON.parse(res.body)
    for (const entry of body.entries) {
      expect(entry.host_api_url).not.toMatch(/\/$/)
    }
  })

  it('D: compact mode preserves host_id and host_api_url', async () => {
    const res = await app.inject({ method: 'GET', url: '/loop/summary?compact=true&limit=5' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    for (const entry of body.entries) {
      expect(entry).toHaveProperty('host_id')
      expect(entry).toHaveProperty('host_api_url')
    }
  })

  it('E: REFLECTT_HOST_API_URL env var is used when set', async () => {
    // Test that the resolution URL reads from env (unit-level — import fn directly)
    const orig = process.env.REFLECTT_HOST_API_URL
    process.env.REFLECTT_HOST_API_URL = 'http://mac-daddy.local:4445'
    try {
      const { getLoopSummary } = await import('../src/insights.js')
      const result = getLoopSummary({ limit: 1 })
      // If there are entries, each must use the env override
      for (const entry of result.entries) {
        expect(entry.host_api_url).toBe('http://mac-daddy.local:4445')
      }
      // Even with no entries, the function must not throw
      expect(Array.isArray(result.entries)).toBe(true)
    } finally {
      if (orig === undefined) delete process.env.REFLECTT_HOST_API_URL
      else process.env.REFLECTT_HOST_API_URL = orig
    }
  })
})
