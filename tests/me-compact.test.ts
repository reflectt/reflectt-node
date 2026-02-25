/**
 * Tests for /me/:agent compact mode.
 * Compact mode strips metadata/description/done_criteria from task arrays,
 * reducing response from ~22K tokens to ~5K tokens.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
const AGENT = `me-compact-test-${Date.now()}`

beforeAll(async () => {
  process.env.REFLECTT_DATA_DIR = `/tmp/reflectt-test-me-compact-${Date.now()}`
  app = await createServer()
  await app.ready()

  // Create a task assigned to our test agent
  await app.inject({
    method: 'POST',
    url: '/tasks',
    payload: {
      title: 'Test task for me-compact',
      description: 'A long description that should be stripped in compact mode',
      assignee: AGENT,
      reviewer: 'ryan',
      priority: 'P2',
      createdBy: AGENT,
      eta: '~1h',
      done_criteria: ['criterion 1', 'criterion 2'],
      metadata: {
        lane: 'test',
        wip_override: true,
        big_blob: 'x'.repeat(500),
      },
    },
  })
})

describe('GET /me/:agent compact mode', () => {
  it('returns full tasks by default', async () => {
    const res = await app.inject({ method: 'GET', url: `/me/${AGENT}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.assignedTasks.length).toBeGreaterThan(0)

    const task = body.assignedTasks[0]
    expect(task.metadata).toBeDefined()
    expect(task.description).toBeDefined()
    expect(task.done_criteria).toBeDefined()
  })

  it('strips heavy fields with compact=true', async () => {
    const res = await app.inject({ method: 'GET', url: `/me/${AGENT}?compact=true` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.assignedTasks.length).toBeGreaterThan(0)

    const task = body.assignedTasks[0]
    expect(task.metadata).toBeUndefined()
    expect(task.description).toBeUndefined()
    expect(task.done_criteria).toBeUndefined()
    // Core fields still present
    expect(task.id).toBeDefined()
    expect(task.title).toBeDefined()
    expect(task.status).toBeDefined()
    expect(task.assignee).toBe(AGENT)
  })

  it('compact response is significantly smaller', async () => {
    const full = await app.inject({ method: 'GET', url: `/me/${AGENT}` })
    const compact = await app.inject({ method: 'GET', url: `/me/${AGENT}?compact=true` })
    const fullSize = full.body.length
    const compactSize = compact.body.length
    // Compact should be meaningfully smaller (at least 20% smaller)
    expect(compactSize).toBeLessThan(fullSize * 0.8)
  })

  it('activeTask is also compacted', async () => {
    const res = await app.inject({ method: 'GET', url: `/me/${AGENT}?compact=true` })
    const body = JSON.parse(res.body)
    if (body.activeTask) {
      expect(body.activeTask.metadata).toBeUndefined()
      expect(body.activeTask.description).toBeUndefined()
      expect(body.activeTask.id).toBeDefined()
    }
  })

  it('non-task fields are unaffected by compact mode', async () => {
    const res = await app.inject({ method: 'GET', url: `/me/${AGENT}?compact=true` })
    const body = JSON.parse(res.body)
    expect(body.agent).toBe(AGENT)
    expect(body.timestamp).toBeDefined()
    expect(body.nextAction).toBeDefined()
    expect(body.failingChecks).toBeDefined()
  })
})
