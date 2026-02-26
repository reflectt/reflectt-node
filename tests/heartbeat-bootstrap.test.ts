import { describe, it, expect, beforeAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
const AGENT = `hb-boot-${Date.now()}`

beforeAll(async () => {
  process.env.REFLECTT_DATA_DIR = `/tmp/reflectt-test-hb-boot-${Date.now()}`
  app = await createServer()
  await app.ready()
})

describe('GET /heartbeat/:agent', () => {
  it('returns compact heartbeat payload', async () => {
    const res = await app.inject({ method: 'GET', url: `/heartbeat/${AGENT}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.agent).toBe(AGENT.toLowerCase())
    expect(body.ts).toBeDefined()
    expect(body.active).toBeNull()
    expect(body.inbox).toBeDefined()
    expect(body.queue).toBeDefined()
    expect(body.action).toBe('HEARTBEAT_OK')
  })

  it('shows active task when agent has doing task', async () => {
    const cr = await app.inject({
      method: 'POST', url: '/tasks',
      payload: { title: 'HB test', description: 'x', assignee: AGENT, reviewer: 'ryan',
        priority: 'P2', createdBy: AGENT, eta: '~1h', done_criteria: ['t'],
        metadata: { wip_override: true, lane: 'test' } },
    })
    const taskId = JSON.parse(cr.body).task.id
    await app.inject({ method: 'PATCH', url: `/tasks/${taskId}`, payload: { status: 'doing' } })

    const res = await app.inject({ method: 'GET', url: `/heartbeat/${AGENT}` })
    const body = JSON.parse(res.body)
    expect(body.active).toBeDefined()
    expect(body.active.id).toBe(taskId)
    expect(body.active.metadata).toBeUndefined()
    expect(body.action).toContain(taskId)
  })

  it('is tiny compared to /me/:agent', async () => {
    const hb = await app.inject({ method: 'GET', url: `/heartbeat/${AGENT}` })
    const me = await app.inject({ method: 'GET', url: `/me/${AGENT}` })
    expect(hb.body.length).toBeLessThan(me.body.length * 0.5)
  })
})

describe('GET /bootstrap/heartbeat/:agent', () => {
  it('returns generated HEARTBEAT.md content', async () => {
    const res = await app.inject({ method: 'GET', url: `/bootstrap/heartbeat/${AGENT}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.agent).toBe(AGENT.toLowerCase())
    expect(body.version).toBeDefined()
    expect(body.content).toBeDefined()
    expect(body.content_hash).toBeDefined()
  })

  it('content references /heartbeat/:agent', async () => {
    const res = await app.inject({ method: 'GET', url: `/bootstrap/heartbeat/${AGENT}` })
    const body = JSON.parse(res.body)
    expect(body.content).toContain(`/heartbeat/${AGENT}`)
    expect(body.content).toContain('HEARTBEAT_OK')
    expect(body.content).toContain('/capabilities')
  })

  it('content is valid markdown', async () => {
    const res = await app.inject({ method: 'GET', url: `/bootstrap/heartbeat/${AGENT}` })
    const body = JSON.parse(res.body)
    expect(body.content).toContain(`# HEARTBEAT.md`)
    expect(body.content).toContain('## Priority Order')
    expect(body.content).toContain('## Rules')
  })
})

describe('GET /capabilities', () => {
  it('returns endpoint discovery payload', async () => {
    const res = await app.inject({ method: 'GET', url: '/capabilities' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.version).toBeDefined()
    expect(body.api_version).toBeDefined()
    expect(body.categories).toBeDefined()
    expect(body.tips).toBeDefined()
  })

  it('lists all major categories', async () => {
    const res = await app.inject({ method: 'GET', url: '/capabilities' })
    const body = JSON.parse(res.body)
    expect(body.categories.heartbeat).toBeDefined()
    expect(body.categories.tasks).toBeDefined()
    expect(body.categories.chat).toBeDefined()
    expect(body.categories.inbox).toBeDefined()
    expect(body.categories.insights).toBeDefined()
    expect(body.categories.system).toBeDefined()
  })

  it('filters by category', async () => {
    const res = await app.inject({ method: 'GET', url: '/capabilities?category=tasks' })
    const body = JSON.parse(res.body)
    expect(body.filtered_by).toBe('tasks')
    expect(Object.keys(body.categories)).toEqual(['tasks'])
    expect(body.categories.tasks.endpoints.length).toBeGreaterThan(0)
  })

  it('is much smaller than /docs', async () => {
    const caps = await app.inject({ method: 'GET', url: '/capabilities' })
    const docs = await app.inject({ method: 'GET', url: '/docs' })
    // Capabilities should be <10% of docs size
    expect(caps.body.length).toBeLessThan(docs.body.length * 0.15)
  })

  it('filtered category is even smaller', async () => {
    const full = await app.inject({ method: 'GET', url: '/capabilities' })
    const filtered = await app.inject({ method: 'GET', url: '/capabilities?category=tasks' })
    expect(filtered.body.length).toBeLessThan(full.body.length * 0.5)
  })
})
