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
        kind: 'pr',
        agentId: 'link',
        label: 'feat(node): canvas artifact stream',
        artifactUrl: 'https://github.com/reflectt/reflectt-node/pull/999',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.kind).toBe('pr')
    expect(body.agentId).toBe('link')
  })

  it('defaults kind to run when unknown kind provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/canvas/artifact',
      payload: {
        kind: 'invalid_kind',
        agentId: 'kai',
        label: 'some work',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.kind).toBe('run')
  })

  it('truncates label to 80 chars', async () => {
    const longLabel = 'a'.repeat(120)
    const res = await app.inject({
      method: 'POST',
      url: '/canvas/artifact',
      payload: {
        kind: 'commit',
        agentId: 'pixel',
        label: longLabel,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.label.length).toBe(80)
  })

  it('accepts approval kind', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/canvas/artifact',
      payload: {
        kind: 'approval',
        agentId: 'sage',
        label: 'task-123 approved and closed',
        taskId: 'task-123',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).success).toBe(true)
  })

  it('accepts test kind', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/canvas/artifact',
      payload: {
        kind: 'test',
        agentId: 'link',
        label: '2128/2128 tests passing',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).kind).toBe('test')
  })

  it('accepts run kind with no artifactUrl', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/canvas/artifact',
      payload: {
        kind: 'run',
        agentId: 'rhythm',
        label: 'sweep complete — 0 zombies',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).success).toBe(true)
  })
})
