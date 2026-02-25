/**
 * Tests for ?compact=true query param on task endpoints.
 * Compact mode strips metadata, description, and done_criteria from responses.
 */
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

async function req(method: string, url: string, body?: unknown) {
  const res = await app.inject({
    method: method as any,
    url,
    payload: body,
    headers: body ? { 'content-type': 'application/json' } : undefined,
  })
  return {
    status: res.statusCode,
    body: JSON.parse(res.body),
  }
}

const AGENT = 'compact-test-agent'

describe('Task compact mode', () => {
  let taskId: string

  beforeAll(async () => {
    const res = await req('POST', '/tasks', {
      title: 'TEST: compact mode test',
      description: 'A lengthy description for testing compact mode stripping',
      status: 'todo',
      assignee: AGENT,
      priority: 'P2',
      done_criteria: ['criterion A', 'criterion B'],
      eta: '1h',
      createdBy: AGENT,
      metadata: {
        is_test: true,
        wip_override: true,
        lane: 'infrastructure',
        qa_bundle: { summary: 'test qa bundle with lots of data' },
      },
    })
    taskId = res.body.task?.id ?? res.body.id
  })

  describe('GET /tasks', () => {
    it('returns full tasks by default', async () => {
      const res = await req('GET', `/tasks?assignee=${AGENT}&include_test=1`)
      expect(res.status).toBe(200)
      const task = res.body.tasks.find((t: any) => t.id === taskId)
      expect(task).toBeDefined()
      expect(task.metadata).toBeDefined()
      expect(task.description).toBeDefined()
      expect(task.done_criteria).toBeDefined()
    })

    it('strips metadata, description, done_criteria with compact=true', async () => {
      const res = await req('GET', `/tasks?assignee=${AGENT}&include_test=1&compact=true`)
      expect(res.status).toBe(200)
      const task = res.body.tasks.find((t: any) => t.id === taskId)
      expect(task).toBeDefined()
      expect(task.metadata).toBeUndefined()
      expect(task.description).toBeUndefined()
      expect(task.done_criteria).toBeUndefined()
      // Core fields preserved
      expect(task.id).toBe(taskId)
      expect(task.title).toBe('TEST: compact mode test')
      expect(task.status).toBe('todo')
      expect(task.assignee).toBe(AGENT)
      expect(task.priority).toBe('P2')
      expect(task.commentCount).toBeDefined()
    })

    it('accepts compact=1 as alias', async () => {
      const res = await req('GET', `/tasks?assignee=${AGENT}&include_test=1&compact=1`)
      expect(res.status).toBe(200)
      const task = res.body.tasks.find((t: any) => t.id === taskId)
      expect(task).toBeDefined()
      expect(task.metadata).toBeUndefined()
    })
  })

  describe('GET /tasks/:id', () => {
    it('returns full task by default', async () => {
      const res = await req('GET', `/tasks/${taskId}`)
      expect(res.status).toBe(200)
      expect(res.body.task.metadata).toBeDefined()
      expect(res.body.task.description).toBeDefined()
    })

    it('strips heavy fields with compact=true', async () => {
      const res = await req('GET', `/tasks/${taskId}?compact=true`)
      expect(res.status).toBe(200)
      expect(res.body.task.metadata).toBeUndefined()
      expect(res.body.task.description).toBeUndefined()
      expect(res.body.task.done_criteria).toBeUndefined()
      expect(res.body.task.id).toBe(taskId)
      expect(res.body.task.title).toBe('TEST: compact mode test')
    })
  })

  describe('GET /tasks/next', () => {
    it('returns full task by default', async () => {
      const res = await req('GET', `/tasks/next?agent=${AGENT}&include_test=1`)
      if (res.body.task) {
        expect(res.body.task.metadata).toBeDefined()
      }
    })

    it('strips heavy fields with compact=true', async () => {
      const res = await req('GET', `/tasks/next?agent=${AGENT}&include_test=1&compact=true`)
      if (res.body.task) {
        expect(res.body.task.metadata).toBeUndefined()
        expect(res.body.task.description).toBeUndefined()
        expect(res.body.task.done_criteria).toBeUndefined()
        expect(res.body.task.id).toBeDefined()
        expect(res.body.task.title).toBeDefined()
      }
    })
  })

  describe('GET /tasks/search', () => {
    it('returns full tasks by default', async () => {
      const res = await req('GET', `/tasks/search?q=compact+mode+test&include_test=1`)
      expect(res.status).toBe(200)
      const task = res.body.tasks.find((t: any) => t.id === taskId)
      if (task) {
        expect(task.metadata).toBeDefined()
      }
    })

    it('strips heavy fields with compact=true', async () => {
      const res = await req('GET', `/tasks/search?q=compact+mode+test&include_test=1&compact=true`)
      expect(res.status).toBe(200)
      const task = res.body.tasks.find((t: any) => t.id === taskId)
      if (task) {
        expect(task.metadata).toBeUndefined()
        expect(task.description).toBeUndefined()
        expect(task.done_criteria).toBeUndefined()
        expect(task.id).toBe(taskId)
      }
    })
  })
})
