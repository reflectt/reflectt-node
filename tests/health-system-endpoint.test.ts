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
  it('includes loop proof fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/system' })
    expect(res.statusCode).toBe(200)

    const body = JSON.parse(res.body)

    expect(typeof body.uptime).toBe('number')
    expect(body.memory).toBeTruthy()

    expect(body.quietHours).toBeTruthy()
    expect(typeof body.quietHours.enabled).toBe('boolean')
    expect(typeof body.quietHours.active).toBe('boolean')

    expect(body.loops).toBeTruthy()
    expect(body.loops.sweeper).toBeTruthy()
    expect(typeof body.loops.sweeper.running).toBe('boolean')

    expect(body.loops.idleNudge).toBeTruthy()
    expect(typeof body.loops.idleNudge.timerRegistered).toBe('boolean')
    expect('lastTickAt' in body.loops.idleNudge).toBe(true)

    expect(body.loops.cadenceWatchdog).toBeTruthy()
    expect(typeof body.loops.cadenceWatchdog.timerRegistered).toBe('boolean')
    expect('lastTickAt' in body.loops.cadenceWatchdog).toBe(true)

    expect(body.loops.mentionRescue).toBeTruthy()
    expect(typeof body.loops.mentionRescue.timerRegistered).toBe('boolean')
    expect('lastTickAt' in body.loops.mentionRescue).toBe(true)

    expect(body.loops.reflectionPipeline).toBeTruthy()
    expect(typeof body.loops.reflectionPipeline.timerRegistered).toBe('boolean')
    expect('lastTickAt' in body.loops.reflectionPipeline).toBe(true)
  })
})
