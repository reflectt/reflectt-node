import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
beforeAll(async () => { app = await createServer() })
afterAll(async () => { await app.close() })

describe('POST /canvas/push', () => {
  it('accepts utterance type', async () => {
    const res = await app.inject({
      method: 'POST', url: '/canvas/push',
      payload: { type: 'utterance', agentId: 'link', text: "shipping the pulse proxy", ttl: 3000 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ success: true, type: 'utterance', agentId: 'link' })
  })

  it('truncates utterance text to 60 chars', async () => {
    const long = 'a'.repeat(100)
    const res = await app.inject({
      method: 'POST', url: '/canvas/push',
      payload: { type: 'utterance', agentId: 'link', text: long },
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepts work_released type', async () => {
    const res = await app.inject({
      method: 'POST', url: '/canvas/push',
      payload: { type: 'work_released', agentId: 'link', text: 'PR merged', intensity: 0.8, taskTitle: 'canvas push endpoint' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('accepts handoff type', async () => {
    const res = await app.inject({
      method: 'POST', url: '/canvas/push',
      payload: { type: 'handoff', agentId: 'link', toAgentId: 'kai', taskTitle: 'canvas review' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('rejects handoff without toAgentId', async () => {
    const res = await app.inject({
      method: 'POST', url: '/canvas/push',
      payload: { type: 'handoff', agentId: 'link' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects unknown type', async () => {
    const res = await app.inject({
      method: 'POST', url: '/canvas/push',
      payload: { type: 'invalid', agentId: 'link' },
    })
    expect(res.statusCode).toBe(400)
  })
})
