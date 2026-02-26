/**
 * Tests for GET /reviews/pending — reviewer pending-reviews list.
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
  const defaults = {
    id,
    title: `Review test ${id}`,
    description: '',
    status: 'validating',
    assignee: 'link',
    reviewer: 'review-tester',
    priority: 'P2',
    created_by: 'test',
    created_at: now,
    updated_at: now,
    done_criteria: '["test passes"]',
    metadata: JSON.stringify({
      artifact_path: 'process/test',
      entered_validating_at: now,
      review_state: 'queued',
      is_test: true,
    }),
    ...overrides,
  }
  db.prepare(`INSERT INTO tasks (id, title, description, status, assignee, reviewer, priority, created_by, created_at, updated_at, done_criteria, metadata)
    VALUES (@id, @title, @description, @status, @assignee, @reviewer, @priority, @created_by, @created_at, @updated_at, @done_criteria, @metadata)`).run(defaults)
  createdIds.push(id)
  return id
}

describe('GET /reviews/pending', () => {
  it('requires reviewer query param', async () => {
    const res = await app.inject({ method: 'GET', url: '/reviews/pending' })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
    expect(body.error).toContain('reviewer')
  })

  it('returns pending reviews for a reviewer', async () => {
    const id = insertTask()
    const res = await app.inject({ method: 'GET', url: '/reviews/pending?reviewer=review-tester' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.reviewer).toBe('review-tester')
    expect(body.pending_count).toBeGreaterThanOrEqual(1)
    const found = body.reviews.find((r: any) => r.id === id)
    expect(found).toBeDefined()
    expect(found.title).toContain('Review test')
    expect(found.age_minutes).toBeDefined()
    expect(found.review_state).toBe('queued')
  })

  it('excludes approved tasks', async () => {
    const id = insertTask({
      metadata: JSON.stringify({
        artifact_path: 'process/test',
        entered_validating_at: Date.now(),
        review_state: 'approved',
        reviewer_approved: true,
        is_test: true,
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/reviews/pending?reviewer=review-tester' })
    const body = JSON.parse(res.body)
    const found = body.reviews.find((r: any) => r.id === id)
    expect(found).toBeUndefined()
  })

  it('excludes tasks for other reviewers', async () => {
    const id = insertTask({ reviewer: 'someone-else' })
    const res = await app.inject({ method: 'GET', url: '/reviews/pending?reviewer=review-tester' })
    const body = JSON.parse(res.body)
    const found = body.reviews.find((r: any) => r.id === id)
    expect(found).toBeUndefined()
  })

  it('supports compact mode', async () => {
    const id = insertTask()
    const res = await app.inject({ method: 'GET', url: '/reviews/pending?reviewer=review-tester&compact=true' })
    const body = JSON.parse(res.body)
    const found = body.reviews.find((r: any) => r.id === id)
    expect(found).toBeDefined()
    expect(found.done_criteria).toBeUndefined()
    expect(found.description).toBeUndefined()
  })

  it('includes pr_url from review_handoff metadata', async () => {
    const id = insertTask({
      metadata: JSON.stringify({
        artifact_path: 'process/test',
        entered_validating_at: Date.now(),
        review_state: 'queued',
        is_test: true,
        review_handoff: { pr_url: 'https://github.com/reflectt/reflectt-node/pull/999' },
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/reviews/pending?reviewer=review-tester' })
    const body = JSON.parse(res.body)
    const found = body.reviews.find((r: any) => r.id === id)
    expect(found).toBeDefined()
    expect(found.pr_url).toBe('https://github.com/reflectt/reflectt-node/pull/999')
  })

  it('is case-insensitive for reviewer name', async () => {
    insertTask()
    const res = await app.inject({ method: 'GET', url: '/reviews/pending?reviewer=REVIEW-TESTER' })
    const body = JSON.parse(res.body)
    expect(body.pending_count).toBeGreaterThanOrEqual(1)
  })
})
