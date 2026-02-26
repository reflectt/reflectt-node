/**
 * Tests for task creation dedup: POST /tasks rejects duplicate title+assignee within window.
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

/** Task payload that exercises dedup (no TEST: prefix, no is_test) */
function dedupTask(overrides: Record<string, unknown> = {}) {
  return {
    title: `Dedup test task ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    assignee: `dedup-agent-${Math.random().toString(36).slice(2, 8)}`,
    reviewer: 'ryan',
    priority: 'P2',
    done_criteria: ['Dedup works correctly'],
    createdBy: 'test-harness',
    eta: '~1h',
    metadata: { wip_override: true },
    ...overrides,
  }
}

/** Task payload that skips dedup (is_test=true) */
function testTask(overrides: Record<string, unknown> = {}) {
  return {
    title: `TEST: dedup-skip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    assignee: `dedup-test-${Math.random().toString(36).slice(2, 8)}`,
    reviewer: 'ryan',
    priority: 'P2',
    done_criteria: ['Works'],
    createdBy: 'test-harness',
    eta: '~1h',
    metadata: { is_test: true, wip_override: true },
    ...overrides,
  }
}

describe('Task creation dedup', () => {
  it('rejects duplicate title+assignee with 409', async () => {
    const assignee = `dedup-dup-${Date.now()}`
    const title = `Dedup duplicate check ${Date.now()}`
    const task = dedupTask({ title, assignee })

    const res1 = await app.inject({ method: 'POST', url: '/tasks', payload: task })
    expect(res1.statusCode).toBe(200)
    const body1 = JSON.parse(res1.body)
    expect(body1.success).toBe(true)
    createdIds.push(body1.task.id)

    // Second identical submission → 409
    const res2 = await app.inject({ method: 'POST', url: '/tasks', payload: task })
    const body2 = JSON.parse(res2.body)
    expect(res2.statusCode).toBe(409)
    expect(body2.code).toBe('DUPLICATE_TASK')
    expect(body2.existing_id).toBe(body1.task.id)
  })

  it('case-insensitive title matching', async () => {
    const assignee = `dedup-case-${Date.now()}`
    const title = `Dedup Case Check ${Date.now()}`
    const task1 = dedupTask({ title, assignee })
    const task2 = dedupTask({ title: title.toLowerCase(), assignee })

    const res1 = await app.inject({ method: 'POST', url: '/tasks', payload: task1 })
    expect(res1.statusCode).toBe(200)
    createdIds.push(JSON.parse(res1.body).task.id)

    const res2 = await app.inject({ method: 'POST', url: '/tasks', payload: task2 })
    expect(res2.statusCode).toBe(409)
    expect(JSON.parse(res2.body).code).toBe('DUPLICATE_TASK')
  })

  it('allows same title with different assignee', async () => {
    const title = `Dedup different assignee ${Date.now()}`
    const task1 = dedupTask({ title, assignee: `agent-a-${Date.now()}` })
    const task2 = dedupTask({ title, assignee: `agent-b-${Date.now()}` })

    const res1 = await app.inject({ method: 'POST', url: '/tasks', payload: task1 })
    expect(res1.statusCode).toBe(200)
    createdIds.push(JSON.parse(res1.body).task.id)

    const res2 = await app.inject({ method: 'POST', url: '/tasks', payload: task2 })
    expect(res2.statusCode).toBe(200)
    createdIds.push(JSON.parse(res2.body).task.id)
  })

  it('skips dedup for TEST: prefixed tasks', async () => {
    const assignee = `dedup-test-prefix-${Date.now()}`
    const title = `TEST: skip dedup ${Date.now()}`
    const task = testTask({ title, assignee })

    const res1 = await app.inject({ method: 'POST', url: '/tasks', payload: task })
    expect(res1.statusCode).toBe(200)
    createdIds.push(JSON.parse(res1.body).task.id)

    const res2 = await app.inject({ method: 'POST', url: '/tasks', payload: task })
    expect(res2.statusCode).toBe(200) // No 409 — TEST: prefix skips dedup
    createdIds.push(JSON.parse(res2.body).task.id)
  })

  it('skips dedup when is_test metadata is set', async () => {
    const assignee = `dedup-is-test-${Date.now()}`
    const title = `Dedup is_test skip ${Date.now()}`
    const task = dedupTask({ title, assignee, metadata: { is_test: true, wip_override: true } })

    const res1 = await app.inject({ method: 'POST', url: '/tasks', payload: task })
    expect(res1.statusCode).toBe(200)
    createdIds.push(JSON.parse(res1.body).task.id)

    const res2 = await app.inject({ method: 'POST', url: '/tasks', payload: task })
    expect(res2.statusCode).toBe(200) // Skipped dedup
    createdIds.push(JSON.parse(res2.body).task.id)
  })

  it('skips dedup when skip_dedup metadata is set', async () => {
    const assignee = `dedup-skip-flag-${Date.now()}`
    const title = `Dedup skip flag ${Date.now()}`
    const task = dedupTask({ title, assignee, metadata: { skip_dedup: true, wip_override: true } })

    const res1 = await app.inject({ method: 'POST', url: '/tasks', payload: task })
    expect(res1.statusCode).toBe(200)
    createdIds.push(JSON.parse(res1.body).task.id)

    const res2 = await app.inject({ method: 'POST', url: '/tasks', payload: task })
    expect(res2.statusCode).toBe(200) // Skipped dedup
    createdIds.push(JSON.parse(res2.body).task.id)
  })

  it('returns existing_id and existing_status in 409 response', async () => {
    const assignee = `dedup-detail-${Date.now()}`
    const title = `Dedup detail check ${Date.now()}`
    const task = dedupTask({ title, assignee })

    const res1 = await app.inject({ method: 'POST', url: '/tasks', payload: task })
    const id1 = JSON.parse(res1.body).task.id
    createdIds.push(id1)

    const res2 = await app.inject({ method: 'POST', url: '/tasks', payload: task })
    const body = JSON.parse(res2.body)
    expect(body.existing_id).toBe(id1)
    expect(body.existing_status).toBeDefined()
    expect(body.hint).toContain(assignee)
  })
})
