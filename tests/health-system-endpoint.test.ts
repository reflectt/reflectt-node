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

describe('GET /health/system', () => {
  it('returns system metrics + loop/timer status', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/system' })
    expect(res.statusCode).toBe(200)

    const body = JSON.parse(res.body)

    // Base metrics (back-compat)
    expect(typeof body.uptime).toBe('number')
    expect(typeof body.uptimeHours).toBe('number')
    expect(typeof body.requestCount).toBe('number')

    // Quiet hours suppression info
    expect(body.quietHours).toBeTruthy()
    expect(typeof body.quietHours.enabled).toBe('boolean')
    expect(typeof body.quietHours.suppressedNow).toBe('boolean')

    // Sweeper status
    expect(body.sweeper).toBeTruthy()
    expect(typeof body.sweeper.running).toBe('boolean')

    // Timers/watchdogs
    expect(body.timers).toBeTruthy()
    for (const k of ['idleNudge', 'cadenceWatchdog', 'mentionRescue', 'reflectionPipeline', 'boardHealthWorker'] as const) {
      expect(body.timers[k]).toBeTruthy()
      expect(typeof body.timers[k].registered).toBe('boolean')
      expect(typeof body.timers[k].lastTickAt).toBe('number')
    }
  })
})
