// Tests for usage tracking + cost guardrails
import { describe, it, expect, beforeAll } from 'vitest'
import Fastify from 'fastify'

describe('Usage Tracking API', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  describe('POST /usage/report', () => {
    it('records a usage event with auto cost estimation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/usage/report',
        payload: {
          agent: 'link',
          model: 'claude-sonnet-4-6',
          provider: 'anthropic',
          input_tokens: 1000,
          output_tokens: 500,
          category: 'task_work',
          task_id: 'task-test-123',
        },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.success).toBe(true)
      expect(body.event.agent).toBe('link')
      expect(body.event.estimated_cost_usd).toBeGreaterThan(0)
      expect(body.event.id).toMatch(/^usage-/)
    })

    it('rejects missing agent', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/usage/report',
        payload: { model: 'gpt-4o' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('accepts explicit cost override', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/usage/report',
        payload: {
          agent: 'sage',
          model: 'custom-model',
          provider: 'custom',
          input_tokens: 100,
          output_tokens: 50,
          estimated_cost_usd: 0.42,
          category: 'review',
        },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.event.estimated_cost_usd).toBe(0.42)
    })
  })

  describe('GET /usage/summary', () => {
    it('returns usage totals', async () => {
      const res = await app.inject({ method: 'GET', url: '/usage/summary' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(Array.isArray(body)).toBe(true)
      expect(body[0]).toHaveProperty('total_cost_usd')
      expect(body[0]).toHaveProperty('event_count')
      expect(body[0].event_count).toBeGreaterThanOrEqual(2) // from previous tests
    })

    it('filters by agent', async () => {
      const res = await app.inject({ method: 'GET', url: '/usage/summary?agent=link' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body[0].event_count).toBeGreaterThanOrEqual(1)
    })
  })

  describe('GET /usage/by-agent', () => {
    it('returns per-agent breakdown', async () => {
      const res = await app.inject({ method: 'GET', url: '/usage/by-agent' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(Array.isArray(body)).toBe(true)
      const linkEntry = body.find((e: any) => e.agent === 'link')
      expect(linkEntry).toBeDefined()
      expect(linkEntry.total_cost_usd).toBeGreaterThan(0)
    })
  })

  describe('GET /usage/by-model', () => {
    it('returns per-model breakdown', async () => {
      const res = await app.inject({ method: 'GET', url: '/usage/by-model' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('GET /usage/estimate', () => {
    it('returns cost estimate for known model', async () => {
      const res = await app.inject({ method: 'GET', url: '/usage/estimate?model=claude-opus-4-6&input_tokens=1000&output_tokens=500' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.estimated_cost_usd).toBeGreaterThan(0)
      expect(body.model).toBe('claude-opus-4-6')
    })
  })

  describe('Spend Caps', () => {
    let capId: string

    it('creates a spend cap', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/usage/caps',
        payload: {
          scope: 'global',
          period: 'monthly',
          limit_usd: 100,
          action: 'warn',
        },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.success).toBe(true)
      expect(body.cap.id).toMatch(/^cap-/)
      capId = body.cap.id
    })

    it('lists caps with status', async () => {
      const res = await app.inject({ method: 'GET', url: '/usage/caps' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.caps.length).toBeGreaterThanOrEqual(1)
      expect(body.status).toBeDefined()
      expect(Array.isArray(body.status)).toBe(true)
    })

    it('deletes a cap', async () => {
      const res = await app.inject({ method: 'DELETE', url: `/usage/caps/${capId}` })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).success).toBe(true)
    })

    it('returns 404 for nonexistent cap', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/usage/caps/nonexistent' })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('GET /usage/routing-suggestions', () => {
    it('returns suggestions array', async () => {
      const res = await app.inject({ method: 'GET', url: '/usage/routing-suggestions' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body).toHaveProperty('suggestions')
      expect(Array.isArray(body.suggestions)).toBe(true)
    })
  })
})
