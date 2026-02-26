import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

const BASE_TASK = {
  title: 'Dedup test: unique task for parallel session testing',
  description: 'Testing task creation dedup',
  assignee: 'dedup-test-agent',
  reviewer: 'ryan',
  priority: 'P2',
  done_criteria: ['Task dedup test passes successfully'],
  eta: '~1h',
  createdBy: 'dedup-test-agent',
  wip_override: true,
}

describe('Task creation dedup', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await createServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('accepts the first task', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: BASE_TASK,
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.task.id).toBeTruthy()
  })

  it('rejects identical task from same assignee within dedup window', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: BASE_TASK,
    })
    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.body)
    expect(body.code).toBe('DUPLICATE_TASK')
    expect(body.hint).toContain('dedup-test-agent')
  })

  it('accepts same title with different assignee', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { ...BASE_TASK, assignee: 'other-agent' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepts different title from same assignee', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { ...BASE_TASK, title: 'Completely different task title for dedup test' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('dedup is case-insensitive', async () => {
    const res1 = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { ...BASE_TASK, assignee: 'case-agent', title: 'Case Test Task' },
    })
    expect(res1.statusCode).toBe(200)

    const res2 = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { ...BASE_TASK, assignee: 'case-agent', title: 'case test task' },
    })
    expect(res2.statusCode).toBe(409)
  })
})
