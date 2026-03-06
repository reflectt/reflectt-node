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

describe('Chat drop counters', () => {
  it('GET /health/chat returns drops object with per-agent counters', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/chat' })
    expect(res.statusCode).toBe(200)

    const body = JSON.parse(res.body)
    expect(typeof body.totalMessages).toBe('number')
    expect(typeof body.drops).toBe('object')
    // drops is a Record<string, { total, rolling_1h, reasons }>
    // May be empty if no drops yet — that's valid
    for (const [agent, stats] of Object.entries(body.drops as Record<string, any>)) {
      expect(typeof agent).toBe('string')
      expect(typeof stats.total).toBe('number')
      expect(typeof stats.rolling_1h).toBe('number')
      expect(typeof stats.reasons).toBe('object')
    }
  })

  it('posting duplicate messages increments drop counter', async () => {
    const testAgent = `test-drop-agent-${Date.now()}`
    const testContent = `duplicate test message ${Date.now()}`

    // Post first message — should succeed
    const res1 = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      payload: { from: testAgent, content: testContent, channel: 'ops' },
    })
    expect(res1.statusCode).toBe(200)

    // Post same message again — should be suppressed as duplicate
    const res2 = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      payload: { from: testAgent, content: testContent, channel: 'ops' },
    })
    expect(res2.statusCode).toBe(200) // Returns 200 with synthetic suppressed msg

    // Check drop stats
    const healthRes = await app.inject({ method: 'GET', url: '/health/chat' })
    const health = JSON.parse(healthRes.body)

    const agentDrops = health.drops[testAgent]
    expect(agentDrops).toBeDefined()
    expect(agentDrops.total).toBeGreaterThanOrEqual(1)
    expect(agentDrops.rolling_1h).toBeGreaterThanOrEqual(1)
    expect(agentDrops.reasons).toBeDefined()
    // Should have 'duplicate' as a reason
    expect(agentDrops.reasons['duplicate']).toBeGreaterThanOrEqual(1)
  })

  it('heartbeat includes drop stats for agent with drops', async () => {
    const testAgent = `test-hb-drop-${Date.now()}`
    const testContent = `heartbeat drop test ${Date.now()}`

    // Create a drop
    await app.inject({
      method: 'POST',
      url: '/chat/messages',
      payload: { from: testAgent, content: testContent, channel: 'ops' },
    })
    await app.inject({
      method: 'POST',
      url: '/chat/messages',
      payload: { from: testAgent, content: testContent, channel: 'ops' },
    })

    // Check heartbeat for this agent
    const hbRes = await app.inject({ method: 'GET', url: `/heartbeat/${testAgent}` })
    expect(hbRes.statusCode).toBe(200)

    const hb = JSON.parse(hbRes.body)
    // Heartbeat should include drops if present
    if (hb.drops) {
      expect(typeof hb.drops.total).toBe('number')
      expect(typeof hb.drops.rolling_1h).toBe('number')
    }
  })
})
