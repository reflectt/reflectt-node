/**
 * Tests for auto-transition: approving a validating task → done.
 * Also tests sweeper skips approved tasks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'
import { getDb } from '../src/db.js'

let app: FastifyInstance
const createdIds: string[] = []

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  const db = getDb()
  for (const id of createdIds) {
    try { db.prepare('DELETE FROM tasks WHERE id = ?').run(id) } catch {}
    try { db.prepare('DELETE FROM task_comments WHERE task_id = ?').run(id) } catch {}
  }
  await app.close()
})

function insertTask(overrides: Record<string, unknown> = {}) {
  const db = getDb()
  const id = `task-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = Date.now()
  const defaultMeta = {
    artifact_path: 'process/test-artifact',
    entered_validating_at: now,
    review_state: 'queued',
    review_last_activity_at: now,
    is_test: true,
  }
  const defaults = {
    id,
    title: `Auto-done test ${id}`,
    description: '',
    status: 'validating',
    assignee: 'link',
    reviewer: 'ryan',
    priority: 'P2',
    created_by: 'test',
    created_at: now,
    updated_at: now,
    done_criteria: '["test passes"]',
    metadata: JSON.stringify(defaultMeta),
    ...overrides,
  }
  db.prepare(`INSERT INTO tasks (id, title, description, status, assignee, reviewer, priority, created_by, created_at, updated_at, done_criteria, metadata)
    VALUES (@id, @title, @description, @status, @assignee, @reviewer, @priority, @created_by, @created_at, @updated_at, @done_criteria, @metadata)`).run(defaults)
  createdIds.push(id)
  return id
}

describe('Review auto-transition to done', () => {
  it('approving a validating task transitions to done', async () => {
    const id = insertTask()

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${id}/review`,
      payload: { reviewer: 'ryan', decision: 'approve', comment: 'Looks good' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.task.status).toBe('done')
    expect(body.task.metadata.auto_closed).toBe(true)
    expect(body.task.metadata.auto_close_reason).toBe('review_approved')
    expect(body.task.metadata.completed_at).toBeDefined()
  })

  it('rejecting a validating task stays in validating', async () => {
    const id = insertTask()

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${id}/review`,
      payload: { reviewer: 'ryan', decision: 'reject', comment: 'Needs changes' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.task.status).toBe('validating')
    expect(body.task.metadata.auto_closed).toBeUndefined()
  })

  it('approving a non-validating task does not change status', async () => {
    const id = insertTask({ status: 'doing', metadata: JSON.stringify({ is_test: true, eta: '~1h' }) })

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${id}/review`,
      payload: { reviewer: 'ryan', decision: 'approve', comment: 'Approved while doing' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.task.status).toBe('doing')
  })

  it('approved tasks do not appear in validating list', async () => {
    const id = insertTask()

    // Approve it
    await app.inject({
      method: 'POST',
      url: `/tasks/${id}/review`,
      payload: { reviewer: 'ryan', decision: 'approve', comment: 'Ship it' },
    })

    // Should not appear in validating list
    const listRes = await app.inject({ method: 'GET', url: '/tasks?status=validating&include_test=1' })
    const tasks = JSON.parse(listRes.body).tasks
    const found = tasks.find((t: any) => t.id === id)
    expect(found).toBeUndefined()
  })
})

describe('Sweeper skips approved tasks', () => {
  it('sweepValidatingQueue does not flag approved tasks', async () => {
    const { sweepValidatingQueue } = await import('../src/executionSweeper.js')
    const id = insertTask({
      metadata: JSON.stringify({
        review_state: 'approved',
        reviewer_approved: true,
        entered_validating_at: Date.now() - 24 * 60 * 60 * 1000, // 24h ago
        review_last_activity_at: Date.now() - 24 * 60 * 60 * 1000,
      }),
    })

    const result = sweepValidatingQueue()
    const violation = result.violations.find(v => v.taskId === id)
    expect(violation).toBeUndefined()
  })
})
