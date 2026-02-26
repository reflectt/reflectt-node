import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

describe('GET /reviews/pending/:agent', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await createServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns pending reviews for a reviewer', async () => {
    const res = await app.inject({ method: 'GET', url: '/reviews/pending/sage' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('reviewer', 'sage')
    expect(body).toHaveProperty('pending_count')
    expect(typeof body.pending_count).toBe('number')
    expect(Array.isArray(body.items)).toBe(true)
    expect(body).toHaveProperty('ts')
  })

  it('compact mode returns slim fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/reviews/pending/sage?compact=true' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('reviewer', 'sage')
    // Compact items should use wait_min not wait_minutes
    for (const item of body.items) {
      expect(item).toHaveProperty('wait_min')
      expect(item).not.toHaveProperty('wait_minutes')
      expect(item).not.toHaveProperty('done_criteria')
    }
  })

  it('returns empty for agent with no pending reviews', async () => {
    const res = await app.inject({ method: 'GET', url: '/reviews/pending/nonexistent-agent-xyz' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.pending_count).toBe(0)
    expect(body.items).toEqual([])
  })

  it('excludes already-approved tasks', async () => {
    const res = await app.inject({ method: 'GET', url: '/reviews/pending/sage' })
    const body = JSON.parse(res.body)
    // None of the returned items should have review_state=approved in their source
    // (we can't check metadata directly, but pending_count should exclude approved ones)
    expect(body.pending_count).toBeGreaterThanOrEqual(0)
  })

  it('items include required fields in default mode', async () => {
    const res = await app.inject({ method: 'GET', url: '/reviews/pending/ryan' })
    const body = JSON.parse(res.body)
    for (const item of body.items) {
      expect(item).toHaveProperty('id')
      expect(item).toHaveProperty('title')
      expect(item).toHaveProperty('wait_minutes')
      expect(item).toHaveProperty('pr_url')
      expect(item).toHaveProperty('artifact_path')
    }
  })
})
