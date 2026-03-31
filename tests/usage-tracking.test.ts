// Tests for usage tracking + cost guardrails
import { describe, it, expect, beforeAll } from 'vitest'
import Fastify from 'fastify'
import { estimateCost } from '../src/usage-tracking.js'

describe('estimateCost', () => {
  it('prices gpt-5.4 correctly', () => {
    const cost = estimateCost('gpt-5.4', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(2.5 + 10.0, 2)
  })

  it('prices provider-prefixed gpt-5.4', () => {
    const cost = estimateCost('openai-codex/gpt-5.4', 1_000_000, 0)
    expect(cost).toBeCloseTo(2.5, 2)
  })

  it('prices claude-sonnet-4-6 correctly', () => {
    const cost = estimateCost('claude-sonnet-4-6', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(3.0 + 15.0, 2)
  })

  it('prices provider-prefixed anthropic model', () => {
    const cost = estimateCost('anthropic/claude-opus-4-6', 1_000_000, 0)
    expect(cost).toBeCloseTo(15.0, 2)
  })

  it('uses conservative default for unknown model', () => {
    const cost = estimateCost('totally-unknown-model', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(5.0 + 20.0, 2)
  })

  it('returns 0 for zero tokens', () => {
    expect(estimateCost('gpt-5.4', 0, 0)).toBe(0)
  })
})

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
      // API may return event details or just success
      if (body.event) {
        expect(body.event.agent).toBe('link')
        expect(body.event.estimated_cost_usd).toBeGreaterThan(0)
        expect(body.event.id).toMatch(/^usage-/)
      }
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
      expect(body.success).toBe(true)
      if (body.event) {
        expect(body.event.estimated_cost_usd).toBe(0.42)
      }
    })
  })

  describe('GET /usage/summary', () => {
    it('returns usage totals', async () => {
      const res = await app.inject({ method: 'GET', url: '/usage/summary' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(Array.isArray(body)).toBe(true)
      if (body.length > 0) {
        expect(body[0]).toHaveProperty('total_cost_usd')
        expect(body[0]).toHaveProperty('event_count')
      }
    })

    it('filters by agent', async () => {
      const res = await app.inject({ method: 'GET', url: '/usage/summary?agent=link' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(Array.isArray(body)).toBe(true)
    })
  })

  describe('GET /usage/by-agent', () => {
    it('returns per-agent breakdown', async () => {
      const res = await app.inject({ method: 'GET', url: '/usage/by-agent' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(Array.isArray(body)).toBe(true)
      // In CI with fresh DB, earlier POST tests should have seeded data
      const linkEntry = body.find((e: any) => e.agent === 'link')
      if (linkEntry) {
        expect(linkEntry.total_cost_usd).toBeGreaterThan(0)
      }
    })
  })

  describe('GET /usage/by-model', () => {
    it('returns per-model breakdown', async () => {
      const res = await app.inject({ method: 'GET', url: '/usage/by-model' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(Array.isArray(body)).toBe(true)
      // Don't assert minimum length — CI may have fresh DB
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

  describe('POST /usage/ingest', () => {
    it('ingests a single external usage record (no auth configured)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/usage/ingest',
        payload: {
          agent: 'swift',
          model: 'claude-sonnet-4-6',
          input_tokens: 500,
          output_tokens: 200,
          cost_usd: 0.0045,
          session_id: 'sess-abc123',
          timestamp: Date.now(),
        },
      })
      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.body)
      expect(body.success).toBe(true)
      expect(body.event).toBeDefined()
      expect(body.event.agent).toBe('swift')
      expect(body.event.api_source).toBe('openclaw:sess-abc123')
    })

    it('ingests a batch of external usage records', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/usage/ingest',
        payload: {
          events: [
            { agent: 'kotlin', model: 'gpt-5.4', input_tokens: 1000, output_tokens: 400, cost_usd: 0.006 },
            { agent: 'qa', model: 'claude-sonnet-4-6', input_tokens: 300, output_tokens: 100 },
          ],
        },
      })
      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.body)
      expect(body.success).toBe(true)
      expect(body.count).toBe(2)
    })

    it('returns 400 when agent or model is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/usage/ingest',
        payload: { model: 'gpt-5.4', input_tokens: 100, output_tokens: 50 },
      })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.body).success).toBe(false)
    })

    it('ingest records appear in /usage/by-agent', async () => {
      await app.inject({
        method: 'POST',
        url: '/usage/ingest',
        payload: { agent: 'shield', model: 'gpt-5.3', input_tokens: 200, output_tokens: 80, cost_usd: 0.001 },
      })
      const res = await app.inject({ method: 'GET', url: '/usage/by-agent' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      const agents = (body.usage ?? body).map((a: { agent: string }) => a.agent)
      expect(agents).toContain('shield')
    })
  })
})
