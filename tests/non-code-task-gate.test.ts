// SPDX-License-Identifier: Apache-2.0
// Non-code task gate tests
// Proves: tasks with non_code=true or non-code lanes can advance to validating
// without PR fields, test_proof, or code-shaped QA bundles.

import { describe, it, expect, afterEach } from 'vitest'
import { taskManager } from '../src/tasks.js'

describe('Non-code task gate', () => {
  const createdTaskIds: string[] = []
  let app: any

  afterEach(() => {
    for (const id of createdTaskIds) {
      try { taskManager.deleteTask(id) } catch { /* ok */ }
    }
    createdTaskIds.length = 0
  })

  async function getApp() {
    if (!app) {
      const { createServer } = await import('../src/server.js')
      app = await createServer()
    }
    return app
  }

  async function createTestTask(overrides: Record<string, unknown> = {}) {
    const task = await taskManager.createTask({
      title: 'TEST: non-code task',
      status: 'todo',
      assignee: 'test-agent',
      reviewer: 'sage',
      createdBy: 'test',
      done_criteria: ['Assessment delivered'],
      metadata: {
        eta: '~2h',
        lane: 'finance',
        reflection_exempt: true,
        reflection_exempt_reason: 'test fixture',
        ...overrides,
      },
    })
    createdTaskIds.push(task.id)
    return task
  }

  it('rejects code-shaped gate for non-code task without non_code flag', async () => {
    const srv = await getApp()
    const task = await createTestTask({ lane: 'engineering' })

    // Move to doing first
    await srv.inject({ method: 'PATCH', url: `/tasks/${task.id}`, payload: { status: 'doing' } })

    // Try to move to validating without PR fields
    const res = await srv.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'validating',
        metadata: {
          review_handoff: {
            task_id: task.id,
            artifact_path: `process/TASK-${task.id.split('-').pop()}.md`,
            known_caveats: 'none',
          },
        },
      },
    })

    expect(res.statusCode).toBe(400)
  })

  it('allows non-code task to validating with non_code=true in review_handoff', async () => {
    const srv = await getApp()
    const task = await createTestTask({ lane: 'finance' })

    await srv.inject({ method: 'PATCH', url: `/tasks/${task.id}`, payload: { status: 'doing' } })

    const res = await srv.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'validating',
        metadata: {
          artifact_path: `process/TASK-${task.id.split('-').pop()}.md`,
          review_handoff: {
            task_id: task.id,
            artifact_path: `process/TASK-${task.id.split('-').pop()}.md`,
            known_caveats: 'none',
            non_code: true,
          },
          qa_bundle: {
            lane: 'finance',
            summary: 'Budget assessment completed.',
            non_code: true,
          },
        },
      },
    })

    const body = JSON.parse(res.body)
    expect(res.statusCode).toBe(200)
    expect(body.task?.status).toBe('validating')
  })

  it('allows ops-lane task to validating without PR fields', async () => {
    const srv = await getApp()
    const task = await createTestTask({ lane: 'ops' })

    await srv.inject({ method: 'PATCH', url: `/tasks/${task.id}`, payload: { status: 'doing' } })

    const res = await srv.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'validating',
        metadata: {
          artifact_path: `process/TASK-${task.id.split('-').pop()}.md`,
          review_handoff: {
            task_id: task.id,
            artifact_path: `process/TASK-${task.id.split('-').pop()}.md`,
            known_caveats: 'none',
            non_code: true,
          },
          qa_bundle: {
            lane: 'ops',
            summary: 'Ops assessment completed.',
            non_code: true,
          },
        },
      },
    })

    const body = JSON.parse(res.body)
    expect(res.statusCode).toBe(200)
    expect(body.task?.status).toBe('validating')
  })

  it('allows task with top-level metadata.non_code=true to validating without PR fields', async () => {
    const srv = await getApp()
    const task = await createTestTask({ lane: 'engineering', non_code: true })

    await srv.inject({ method: 'PATCH', url: `/tasks/${task.id}`, payload: { status: 'doing' } })

    const res = await srv.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'validating',
        metadata: {
          non_code: true,
          artifact_path: `process/TASK-${task.id.split('-').pop()}.md`,
          review_handoff: {
            task_id: task.id,
            artifact_path: `process/TASK-${task.id.split('-').pop()}.md`,
            known_caveats: 'none',
            non_code: true,
          },
        },
      },
    })

    const body = JSON.parse(res.body)
    expect(res.statusCode).toBe(200)
    expect(body.task?.status).toBe('validating')
  })

  it('taskPrecheck returns non-code template for ops-lane task', async () => {
    const { runPrecheck } = await import('../src/taskPrecheck.js')
    const task = await createTestTask({ lane: 'ops' })

    const result = runPrecheck(task.id, 'validating')
    // Should not flag pr_url or commit_sha as errors
    const errorFields = result.items.filter(i => i.severity === 'error').map(i => i.field)
    expect(errorFields).not.toContain('metadata.review_handoff.pr_url')
    expect(errorFields).not.toContain('metadata.review_handoff.commit_sha')
    expect(errorFields).not.toContain('metadata.review_handoff.test_proof')
    // Template should be non-code format (no pr_url/commit_sha placeholders)
    const template = result.template as Record<string, unknown> | null
    const handoff = (template?.metadata as any)?.review_handoff as Record<string, unknown> | undefined
    expect(handoff).toBeDefined()
    expect(handoff?.non_code).toBe(true)
    expect(handoff?.pr_url).toBeUndefined()
    expect(handoff?.commit_sha).toBeUndefined()
  })

  it('error message mentions non_code=true as escape hatch', async () => {
    const srv = await getApp()
    const task = await createTestTask({ lane: 'engineering' })

    await srv.inject({ method: 'PATCH', url: `/tasks/${task.id}`, payload: { status: 'doing' } })

    const res = await srv.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'validating',
        metadata: {
          review_handoff: {
            task_id: task.id,
            artifact_path: `process/TASK-${task.id.split('-').pop()}.md`,
            known_caveats: 'none',
          },
        },
      },
    })

    const body = JSON.parse(res.body)
    expect(res.statusCode).toBe(400)
    // Error or hint should mention non_code
    const fullText = `${body.error || ''} ${body.hint || ''}`
    expect(fullText).toMatch(/non.?code/i)
  })
})
