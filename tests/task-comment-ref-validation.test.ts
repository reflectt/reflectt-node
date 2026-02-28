/**
 * Task comment: invalid task ID reference validation.
 *
 * POST /tasks/:id/comments should detect task-XXX references in content.
 *
 * NOTE: This is now a *hard guardrail* — if a comment references nonexistent task IDs,
 * the request is rejected (422) and the comment is not stored.
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
    json: JSON.parse(res.payload),
  }
}

describe('POST /tasks/:id/comments — task ID ref validation', () => {
  let taskId: string

  it('setup: create a task', async () => {
    const res = await req('POST', '/tasks', {
      title: 'TEST: Ref validation test task',
      description: 'Test task for comment ref validation',
      assignee: 'link',
      reviewer: 'sage',
      status: 'doing',
      createdBy: 'test-runner',
      priority: 'P2',
      done_criteria: ['Test task ref validation'],
      eta: '1h',
    })
    expect(res.status).toBe(200)
    taskId = res.json.task.id
  })

  it('comment with no task refs returns no warning', async () => {
    const res = await req('POST', `/tasks/${taskId}/comments`, {
      author: 'link',
      content: 'Just a regular comment with no task references.',
    })
    expect(res.status).toBe(200)
    expect(res.json.success).toBe(true)
    expect(res.json.warning).toBeUndefined()
    expect(res.json.invalid_task_refs).toBeUndefined()
  })

  it('comment referencing self task returns no warning', async () => {
    const res = await req('POST', `/tasks/${taskId}/comments`, {
      author: 'link',
      content: `Working on ${taskId} — progressing well.`,
    })
    expect(res.status).toBe(200)
    expect(res.json.success).toBe(true)
    expect(res.json.warning).toBeUndefined()
  })

  it('comment referencing non-existent task is rejected (no storage)', async () => {
    const fakeId = 'task-9999999999999-xxxxxxxxx'
    const res = await req('POST', `/tasks/${taskId}/comments`, {
      author: 'link',
      content: `See also ${fakeId} for context.`,
    })
    expect(res.status).toBe(422)
    expect(res.json.success).toBe(false)
    expect(res.json.code).toBe('INVALID_TASK_REFS')
    expect(res.json.invalid_task_refs).toContain(fakeId)
    expect(res.json.reject_id).toBeDefined()

    const listRes = await req('GET', `/tasks/${taskId}/comments`)
    expect(listRes.status).toBe(200)
    expect(listRes.json.comments.some((c: any) => String(c.content).includes(fakeId))).toBe(false)
  })

  it('comment referencing valid + invalid tasks is rejected with invalid list', async () => {
    const fakeId = 'task-0000000000000-fakefakefake'
    const res = await req('POST', `/tasks/${taskId}/comments`, {
      author: 'link',
      content: `Depends on ${taskId} and ${fakeId}.`,
    })
    expect(res.status).toBe(422)
    expect(res.json.success).toBe(false)
    expect(res.json.code).toBe('INVALID_TASK_REFS')
    expect(res.json.invalid_task_refs).toContain(fakeId)
    expect(res.json.invalid_task_refs).not.toContain(taskId)
    expect(res.json.reject_id).toBeDefined()
  })

  it('comment is not stored when invalid refs exist (reject ledger)', async () => {
    const fakeId = 'task-1111111111111-ghostghost'
    const res = await req('POST', `/tasks/${taskId}/comments`, {
      author: 'link',
      content: `Referencing ghost ${fakeId} here.`,
    })
    expect(res.status).toBe(422)
    expect(res.json.success).toBe(false)
    expect(res.json.code).toBe('INVALID_TASK_REFS')
    expect(res.json.invalid_task_refs).toContain(fakeId)
    expect(res.json.reject_id).toBeDefined()

    // Verify comment is NOT retrievable
    const listRes = await req('GET', `/tasks/${taskId}/comments`)
    expect(listRes.status).toBe(200)
    expect(listRes.json.comments.some((c: any) => String(c.content).includes(fakeId))).toBe(false)
  })
})
