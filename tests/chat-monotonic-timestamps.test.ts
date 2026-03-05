import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  process.env.REFLECTT_DATA_DIR = `/tmp/reflectt-test-monotonic-${Date.now()}`
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

async function post(content: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/chat/messages',
    payload: { from: 'system', channel: 'task-notifications', content },
  })
  expect(res.statusCode).toBe(200)
  return JSON.parse(res.body).message as { id: string; timestamp: number }
}

describe('Chat message timestamps are monotonic', () => {
  it('bumps timestamp when multiple messages share the same Date.now()', async () => {
    const fixed = 1772720000000
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => fixed)

    const a = await post('A ' + Math.random())
    const b = await post('B ' + Math.random())

    spy.mockRestore()

    expect(typeof a.timestamp).toBe('number')
    expect(typeof b.timestamp).toBe('number')
    expect(b.timestamp).toBeGreaterThan(a.timestamp)

    // id should embed the monotonic timestamp used.
    const aTs = Number(a.id.split('-')[1])
    const bTs = Number(b.id.split('-')[1])
    expect(bTs).toBeGreaterThan(aTs)
  })
})
