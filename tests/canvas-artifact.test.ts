import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer as buildApp } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('POST /canvas/artifact', () => {
  it('emits a pr artifact and returns success', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/canvas/artifact',
      payload: {
        type: 'pr',
        agentId: 'link',
        title: 'feat(node): canvas artifact stream',
        url: 'https://github.com/reflectt/reflectt-node/pull/999',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.type).toBe('pr')
    expect(body.agentId).toBe('link')
  })

  it('defaults type to run when unknown type provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/canvas/artifact',
      payload: {
        type: 'invalid_type',
        agentId: 'kai',
        title: 'some work',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.type).toBe('run')
  })

  it('truncates title to 80 chars', async () => {
    const longTitle = 'a'.repeat(120)
    const res = await app.inject({
      method: 'POST',
      url: '/canvas/artifact',
      payload: {
        type: 'commit',
        agentId: 'pixel',
        title: longTitle,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
  })

  it('accepts approval type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/canvas/artifact',
      payload: {
        type: 'approval',
        agentId: 'sage',
        title: 'task-123 approved and closed',
        taskId: 'task-123',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).success).toBe(true)
  })

  it('accepts test type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/canvas/artifact',
      payload: {
        type: 'test',
        agentId: 'link',
        title: '2122/2122 tests passing',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).type).toBe('test')
  })

  it('accepts run type with no url', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/canvas/artifact',
      payload: {
        type: 'run',
        agentId: 'rhythm',
        title: 'sweep complete — 0 zombies',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).success).toBe(true)
  })
})
