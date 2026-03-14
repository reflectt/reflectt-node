// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { taskManager } from '../src/tasks.js'

describe('lane template done→successor autogen (e2e via TaskManager)', () => {
  it('creates one successor when ops-lane task with next_scope transitions to done', async () => {
    const parent = await taskManager.createTask({
      title: 'TEST: ops lane parent task',
      description: 'seed parent for successor autogen',
      createdBy: 'test',
      status: 'doing',
      assignee: 'rhythm',
      reviewer: 'coo',
      done_criteria: ['ship test artifact'],
      metadata: {
        is_test: true,
        reflection_exempt: true,
        reflection_exempt_reason: 'test',
        eta: '~10m',
        lane: 'ops',
        next_scope: 'validate auto-generated successor from template',
      },
    })

    const done = await taskManager.updateTask(parent.id, { status: 'done' })
    expect(done?.status).toBe('done')

    const successors = taskManager.listTasks({ includeTest: true }).filter(t => {
      const meta = (t.metadata || {}) as Record<string, unknown>
      return meta.parent_task_id === parent.id
    })
    expect(successors.length).toBe(1)

    const successor = successors[0]
    expect(successor.title.toLowerCase()).toContain('ops follow-up')
    expect(successor.description || '').toContain(parent.id)
    expect(successor.assignee).toBe(parent.assignee)

    const meta = (successor.metadata || {}) as Record<string, unknown>
    expect(meta.parent_task_id).toBe(parent.id)
    expect(meta.generated_by).toBe('lane-template-successor')
  })

  it('does not create duplicate successor on repeated done updates', async () => {
    const parent = await taskManager.createTask({
      title: 'TEST: ops lane idempotency parent',
      createdBy: 'test',
      status: 'doing',
      assignee: 'rhythm',
      reviewer: 'coo',
      done_criteria: ['ship test artifact'],
      metadata: {
        is_test: true,
        reflection_exempt: true,
        reflection_exempt_reason: 'test',
        eta: '~10m',
        lane: 'ops',
        next_scope: 'idempotency verification',
      },
    })

    await taskManager.updateTask(parent.id, { status: 'done' })
    await taskManager.updateTask(parent.id, { status: 'done' })

    const successors = taskManager.listTasks({ includeTest: true }).filter(t => {
      const meta = (t.metadata || {}) as Record<string, unknown>
      return meta.parent_task_id === parent.id
    })
    expect(successors.length).toBe(1)
  })
})
