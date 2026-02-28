// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { taskManager } from '../src/tasks.js'

const AGENT = 'rqf-next-tester'
const PREFIX = 'TEST: next-validating'

describe('/tasks/next validating-only suggestion', () => {
  const created: string[] = []

  afterEach(() => {
    for (const id of created) {
      try { taskManager.deleteTask(id) } catch {}
    }
    created.length = 0
  })

  it('getNextTask returns null when agent has only validating tasks', async () => {
    const v = await taskManager.createTask({
      title: `${PREFIX}: validating task`,
      assignee: AGENT,
      status: 'validating',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'sage',
      metadata: { artifact_path: 'process/TEST.md' },
    })
    created.push(v.id)

    const next = taskManager.getNextTask(AGENT)
    expect(next).toBeFalsy()
  })

  it('detects validating-only state: 0 todo, 0 doing, >0 validating', async () => {
    const v = await taskManager.createTask({
      title: `${PREFIX}: validating task`,
      assignee: AGENT,
      status: 'validating',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'sage',
      metadata: { artifact_path: 'process/TEST.md' },
    })
    created.push(v.id)

    const doingTasks = taskManager.listTasks({ status: 'doing', assignee: AGENT })
    const validatingTasks = taskManager.listTasks({ status: 'validating', assignee: AGENT })
    const todoTasks = taskManager.listTasks({ status: 'todo', assignee: AGENT })

    expect(doingTasks.length).toBe(0)
    expect(validatingTasks.length).toBeGreaterThan(0)
    expect(todoTasks.length).toBe(0)
  })

  it('suggests unassigned backlog tasks when agent is validating-only', async () => {
    // Create a validating task for the agent
    const v = await taskManager.createTask({
      title: `${PREFIX}: validating task`,
      assignee: AGENT,
      status: 'validating',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'sage',
      metadata: { artifact_path: 'process/TEST.md' },
    })
    created.push(v.id)

    // Create an unassigned backlog task (omit assignee so it's NULL in DB)
    const backlog = await taskManager.createTask({
      title: `${PREFIX}: unassigned backlog task`,
      status: 'todo',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'sage',
    })
    created.push(backlog.id)

    // Simulate the suggestion logic from /tasks/next
    const doingTasks = taskManager.listTasks({ status: 'doing', assignee: AGENT })
    const validatingTasks = taskManager.listTasks({ status: 'validating', assignee: AGENT })

    expect(doingTasks.length).toBe(0)
    expect(validatingTasks.length).toBeGreaterThan(0)

    // Get unassigned todo tasks (the suggestion pool — matches server.ts logic)
    const allTodo = taskManager.listTasks({ status: 'todo' })
    const unassignedTodo = allTodo.filter(t => !t.assignee)

    // The backlog task should be in the unassigned pool
    const match = unassignedTodo.find(t => t.title?.includes('unassigned backlog task'))
    expect(match).toBeDefined()
    expect(match!.id).toBe(backlog.id)
  })

  it('does not suggest tasks that are already assigned', async () => {
    const v = await taskManager.createTask({
      title: `${PREFIX}: validating task`,
      assignee: AGENT,
      status: 'validating',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'sage',
      metadata: { artifact_path: 'process/TEST.md' },
    })
    created.push(v.id)

    // Assigned to someone else — should NOT appear in suggestions
    const assigned = await taskManager.createTask({
      title: `${PREFIX}: assigned to someone else`,
      assignee: 'other-agent',
      status: 'todo',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'sage',
    })
    created.push(assigned.id)

    const unassignedTodo = taskManager.listTasks({ status: 'todo' })
      .filter(t => !t.assignee || t.assignee === '')

    const match = unassignedTodo.find(t => t.id === assigned.id)
    expect(match).toBeUndefined()
  })
})
