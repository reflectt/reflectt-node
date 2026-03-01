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
