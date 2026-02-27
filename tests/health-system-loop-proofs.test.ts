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

describe('GET /health/system (loop proofs)', () => {
  it('includes quietHours + sweeper + timers proof fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/system' })
    expect(res.statusCode).toBe(200)

    const body = JSON.parse(res.body)

    expect(body).toHaveProperty('uptime')
    expect(body).toHaveProperty('memory')

    expect(body).toHaveProperty('quietHours')
    expect(typeof body.quietHours.enabled).toBe('boolean')
    expect(typeof body.quietHours.suppressedNow).toBe('boolean')

    expect(body).toHaveProperty('sweeper')
    expect(typeof body.sweeper.running).toBe('boolean')

    expect(body).toHaveProperty('timers')
    for (const key of ['idleNudge', 'cadenceWatchdog', 'mentionRescue', 'reflectionPipeline', 'boardHealthWorker']) {
      expect(body.timers).toHaveProperty(key)
      expect(typeof body.timers[key].registered).toBe('boolean')
      expect('lastTickAt' in body.timers[key]).toBe(true)
    }
  })
})
