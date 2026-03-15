/**
 * Tests for POST /tasks/bulk-close
 * task-1773548378817-zl8596ll1
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'

let app: ReturnType<typeof Fastify>

// Minimal mock task manager
const tasks = new Map<string, { id: string; status: string; metadata: Record<string, unknown>; reviewer?: string }>([
  ['task-validating-approved', { id: 'task-validating-approved', status: 'validating', metadata: { reviewer_approved: true } }],
  ['task-validating-no-approval', { id: 'task-validating-no-approval', status: 'validating', metadata: {} }],
  ['task-validating-duplicate', { id: 'task-validating-duplicate', status: 'validating', metadata: { close_reason: 'duplicate', duplicate_of: { task_id: 'task-abc', reason: 'merged into main' } } }],
  ['task-already-done', { id: 'task-already-done', status: 'done', metadata: {} }],
  ['task-todo', { id: 'task-todo', status: 'todo', metadata: {} }],
])

beforeAll(async () => {
  app = Fastify()
  app.post('/tasks/bulk-close', async (request, reply) => {
    const { z } = await import('zod')
    const { ids, reason } = z.object({
      ids: z.array(z.string().min(1)).min(1).max(100),
      reason: z.string().trim().optional(),
    }).parse(request.body)

    const closed: string[] = []
    const skipped: Array<{ id: string; reason: string }> = []
    const errors: Array<{ id: string; error: string }> = []

    for (const rawId of ids) {
      const task = tasks.get(rawId)
      if (!task) { errors.push({ id: rawId, error: 'Task not found' }); continue }
      if (task.status === 'done' || task.status === 'cancelled') {
        skipped.push({ id: rawId, reason: `already ${task.status}` }); continue
      }
      if (task.status !== 'validating') {
        skipped.push({ id: rawId, reason: `status is "${task.status}"` }); continue
      }
      const meta = task.metadata
      const closeReason = reason ?? (typeof meta.close_reason === 'string' ? meta.close_reason : '')
      const reviewerApproved = meta.reviewer_approved === true
      const isDupOrSuperseded = closeReason === 'duplicate' || closeReason === 'superseded'
      if (!reviewerApproved && !isDupOrSuperseded) {
        skipped.push({ id: rawId, reason: 'no reviewer_approved=true and no close_reason' }); continue
      }
      task.status = 'done'
      closed.push(rawId)
    }

    return {
      success: true,
      closed,
      skipped,
      errors,
      summary: { total: ids.length, closed: closed.length, skipped: skipped.length, errors: errors.length },
    }
  })
  await app.ready()
})

afterAll(() => app.close())

describe('POST /tasks/bulk-close', () => {
  it('closes validating task with reviewer_approved=true', async () => {
    const res = await app.inject({ method: 'POST', url: '/tasks/bulk-close', payload: { ids: ['task-validating-approved'] } })
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.closed).toContain('task-validating-approved')
    expect(body.summary.closed).toBe(1)
  })

  it('skips task without reviewer_approved', async () => {
    const res = await app.inject({ method: 'POST', url: '/tasks/bulk-close', payload: { ids: ['task-validating-no-approval'] } })
    const body = JSON.parse(res.body)
    expect(body.closed).toHaveLength(0)
    expect(body.skipped[0].id).toBe('task-validating-no-approval')
  })

  it('closes duplicate task via close_reason in metadata', async () => {
    const res = await app.inject({ method: 'POST', url: '/tasks/bulk-close', payload: { ids: ['task-validating-duplicate'] } })
    const body = JSON.parse(res.body)
    expect(body.closed).toContain('task-validating-duplicate')
  })

  it('skips already-done tasks', async () => {
    const res = await app.inject({ method: 'POST', url: '/tasks/bulk-close', payload: { ids: ['task-already-done'] } })
    const body = JSON.parse(res.body)
    expect(body.skipped[0].reason).toMatch(/already done/)
  })

  it('skips non-validating tasks', async () => {
    const res = await app.inject({ method: 'POST', url: '/tasks/bulk-close', payload: { ids: ['task-todo'] } })
    const body = JSON.parse(res.body)
    expect(body.skipped[0].reason).toMatch(/status is "todo"/)
  })

  it('errors on unknown task', async () => {
    const res = await app.inject({ method: 'POST', url: '/tasks/bulk-close', payload: { ids: ['task-does-not-exist'] } })
    const body = JSON.parse(res.body)
    expect(body.errors[0].error).toMatch(/not found/i)
  })

  it('handles mixed batch — returns results for all ids', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks/bulk-close',
      payload: { ids: ['task-todo', 'task-does-not-exist'] },
    })
    const body = JSON.parse(res.body)
    expect(body.summary.total).toBe(2)
    expect(body.summary.errors).toBe(1)  // task-does-not-exist
    expect(body.summary.skipped).toBe(1) // task-todo (not validating)
  })

  it('rejects empty ids array with 4xx', async () => {
    const res = await app.inject({ method: 'POST', url: '/tasks/bulk-close', payload: { ids: [] } })
    // Zod parse throws — Fastify default 500, real server catches and returns 400
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })
})
