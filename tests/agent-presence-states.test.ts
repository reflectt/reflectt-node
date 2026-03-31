/**
 * Tests for AgentPresenceSchema state enum widening.
 * Verifies all 9 valid states are accepted and invalid states are rejected.
 *
 * task-1773442756827-va3jfqwqe
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeEach(async () => {
  app = await createServer({ logger: false })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const BASE_PAYLOAD = {
  activeTask: { title: 'Test task', id: 'task-test-123' },
  recency: '1m ago',
  sensors: null,
}

const VALID_STATES = [
  'idle',
  'working',
  'thinking',
  'rendering',
  'needs-attention',
  'urgent',
  'handoff',
  'decision',
  'waiting',
] as const

describe('AgentPresenceSchema — state enum', () => {
  for (const state of VALID_STATES) {
    it(`accepts state="${state}"`, async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/agents/link/canvas',
        payload: { ...BASE_PAYLOAD, state },
      })
      expect(res.statusCode, `state="${state}" should be 200`).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.success ?? body.name).toBeTruthy()
    })
  }

  it('rejects an invalid state with 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents/link/canvas',
      payload: { ...BASE_PAYLOAD, state: 'flying' },
    })
    expect(res.statusCode).toBe(422)
    const body = JSON.parse(res.body)
    // Error may be wrapped by global handler — check it contains the enum rejection message
    const errorText = JSON.stringify(body)
    expect(errorText).toContain('Invalid')
    expect(errorText).toContain('flying')
  })

  it('rejects missing state with 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents/link/canvas',
      payload: { ...BASE_PAYLOAD },
    })
    expect(res.statusCode).toBe(422)
  })

  it('accepts thinking with currentPr and progress', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents/link/canvas',
      payload: { ...BASE_PAYLOAD, state: 'thinking', currentPr: 944, progress: 0.65 },
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepts urgent with attention block', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents/link/canvas',
      payload: {
        ...BASE_PAYLOAD,
        state: 'urgent',
        attention: { type: 'block', taskId: 'task-abc', label: 'Blocked on deploy' },
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepts decision with attention review', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents/link/canvas',
      payload: {
        ...BASE_PAYLOAD,
        state: 'decision',
        attention: { type: 'review', taskId: 'task-abc' },
      },
    })
    expect(res.statusCode).toBe(200)
  })
})
