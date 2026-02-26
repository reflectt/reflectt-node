/**
 * Tests for phantom task-comment chat guard.
 * POST /chat/messages rejects [task-comment:task-...] when task doesn't exist.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
const createdIds: string[] = []

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  for (const id of createdIds) {
    try { await app.inject({ method: 'DELETE', url: `/tasks/${id}` }) } catch {}
  }
  await app.close()
})

describe('Phantom task-comment chat guard', () => {
  it('rejects [task-comment:task-...] when task does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      payload: {
        from: 'link',
        channel: 'task-comments',
        content: '@sage [task-comment:task-nonexistent-999] Starting work on this',
      },
    })
    expect(res.statusCode).toBe(422)
    const body = JSON.parse(res.body)
    expect(body.code).toBe('PHANTOM_TASK_COMMENT')
    expect(body.error).toContain('does not exist')
  })

  it('allows [task-comment:task-...] when task exists', async () => {
    // Create a real task first
    const taskRes = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        title: 'TEST: phantom guard real task',
        assignee: `phantom-guard-${Date.now()}`,
        reviewer: 'ryan',
        priority: 'P2',
        done_criteria: ['test'],
        createdBy: 'test',
        eta: '1h',
        metadata: { is_test: true, wip_override: true, skip_dedup: true },
      },
    })
    const taskId = JSON.parse(taskRes.body).task.id
    createdIds.push(taskId)

    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      payload: {
        from: 'link',
        channel: 'task-comments',
        content: `@sage [task-comment:${taskId}] Starting work on this`,
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it('allows messages without [task-comment:...] tag', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      payload: {
        from: 'link',
        channel: 'general',
        content: 'Just a normal message about tasks',
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it('allows [task-comment:...] with non-task-id format (e.g. tcomment)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      payload: {
        from: 'link',
        channel: 'task-comments',
        content: 'Reference: [task-comment:tcomment-123] was useful',
      },
    })
    // tcomment- doesn't match task- pattern, so guard doesn't trigger
    expect(res.statusCode).toBe(200)
  })
})
