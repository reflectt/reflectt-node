// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, afterEach } from 'vitest'
import { taskManager } from '../src/tasks.js'

const CREATED: string[] = []

afterEach(() => {
  for (const id of CREATED) {
    try { taskManager.deleteTask(id) } catch {}
  }
  CREATED.length = 0
})

describe('getNextTask unassigned sentinel', () => {
  it('treats assignee="unassigned" as unassigned for pull-based routing', async () => {
    const t = await taskManager.createTask({
      title: 'TEST: unassigned sentinel pull',
      status: 'todo',
      assignee: 'unassigned',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'sage',
    })
    CREATED.push(t.id)

    const next = taskManager.getNextTask('some-agent')
    expect(next).toBeTruthy()
    expect(next!.id).toBe(t.id)
  })
})
