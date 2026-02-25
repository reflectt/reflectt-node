/**
 * Tests for GET /tasks/active and inbox compact mode.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
const AGENT = `active-test-${Date.now()}`
let taskId: string

beforeAll(async () => {
  process.env.REFLECTT_DATA_DIR = `/tmp/reflectt-test-active-${Date.now()}`
  app = await createServer()
  await app.ready()

  // Create and move a task to doing
  const createRes = await app.inject({
    method: 'POST', url: '/tasks',
    payload: {
      title: 'Active task test',
      description: 'Description for testing',
      assignee: AGENT,
      reviewer: 'ryan',
      priority: 'P2',
      createdBy: AGENT,
      eta: '~1h',
      done_criteria: ['test passes'],
      metadata: { lane: 'test', wip_override: true },
    },
  })
  taskId = JSON.parse(createRes.body).task.id

  await app.inject({
    method: 'PATCH', url: `/tasks/${taskId}`,
    payload: { status: 'doing' },
  })

  // Seed an inbox message
  await app.inject({
    method: 'POST', url: '/chat/messages',
    payload: { from: 'kai', content: `@${AGENT} heads up on task-123`, channel: 'general' },
  })
})

describe('GET /tasks/active', () => {
  it('returns active task for agent', async () => {
    const res = await app.inject({ method: 'GET', url: `/tasks/active?agent=${AGENT}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.task).toBeDefined()
    expect(body.task.id).toBe(taskId)
    expect(body.task.status).toBe('doing')
  })

  it('returns null when no active tasks', async () => {
    const res = await app.inject({ method: 'GET', url: '/tasks/active?agent=nobody-agent' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.task).toBeNull()
  })

  it('supports compact mode', async () => {
    const full = await app.inject({ method: 'GET', url: `/tasks/active?agent=${AGENT}` })
    const compact = await app.inject({ method: 'GET', url: `/tasks/active?agent=${AGENT}&compact=true` })
    const fullBody = JSON.parse(full.body)
    const compactBody = JSON.parse(compact.body)

    expect(fullBody.task.metadata).toBeDefined()
    expect(fullBody.task.description).toBeDefined()
    expect(compactBody.task.metadata).toBeUndefined()
    expect(compactBody.task.description).toBeUndefined()
    expect(compactBody.task.id).toBe(taskId)
  })

  it('requires agent param', async () => {
    const res = await app.inject({ method: 'GET', url: '/tasks/active' })
    const body = JSON.parse(res.body)
    expect(body.task).toBeNull()
  })
})

describe('GET /inbox/:agent compact mode', () => {
  it('returns full messages by default', async () => {
    const res = await app.inject({ method: 'GET', url: `/inbox/${AGENT}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    if (body.messages.length > 0) {
      expect(body.messages[0].id).toBeDefined()
      expect(body.messages[0].reactions).toBeDefined()
    }
  })

  it('returns slim messages with compact=true', async () => {
    const res = await app.inject({ method: 'GET', url: `/inbox/${AGENT}?compact=true` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    if (body.messages.length > 0) {
      const msg = body.messages[0]
      expect(msg.from).toBeDefined()
      expect(msg.content).toBeDefined()
      expect(msg.ts).toBeDefined()
      expect(msg.ch).toBeDefined()
      // Stripped fields
      expect(msg.id).toBeUndefined()
      expect(msg.reactions).toBeUndefined()
      expect(msg.replyCount).toBeUndefined()
    }
  })

  it('compact is smaller than full', async () => {
    const full = await app.inject({ method: 'GET', url: `/inbox/${AGENT}` })
    const compact = await app.inject({ method: 'GET', url: `/inbox/${AGENT}?compact=true` })
    expect(compact.body.length).toBeLessThanOrEqual(full.body.length)
  })
})
