/**
 * Regression: posting a task comment must advance task.updatedAt.
 *
 * This is required for autonomy enforcement and “activity signal” to treat
 * comments as real work (not forcing metadata churn via PATCH).
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

describe('Task comment activity', () => {
  it('POST /tasks/:id/comments advances task.updatedAt', async () => {
    const created = await req('POST', '/tasks', {
      title: 'TEST: comment updates updatedAt',
      description: 'regression test',
      status: 'todo',
      createdBy: 'test-runner',
      assignee: 'spark',
      reviewer: 'sage',
      priority: 'P2',
      done_criteria: ['Verify updatedAt advances when a task comment is posted'],
      eta: '1h',
    })

    expect(created.status).toBe(200)
    const taskId = created.body.task.id as string

    const before = await req('GET', `/tasks/${taskId}`)
    expect(before.status).toBe(200)
    const beforeUpdatedAt = before.body.task.updatedAt as number

    const commentRes = await req('POST', `/tasks/${taskId}/comments`, {
      author: 'spark',
      content: 'hello',
    })
    expect(commentRes.status).toBe(200)
    expect(commentRes.body.success).toBe(true)

    const commentTs = commentRes.body.comment.timestamp as number

    const after = await req('GET', `/tasks/${taskId}`)
    expect(after.status).toBe(200)
    const afterUpdatedAt = after.body.task.updatedAt as number

    expect(afterUpdatedAt).toBeGreaterThanOrEqual(commentTs)
    expect(afterUpdatedAt).toBeGreaterThanOrEqual(beforeUpdatedAt)

    await req('DELETE', `/tasks/${taskId}`)
  })
})
