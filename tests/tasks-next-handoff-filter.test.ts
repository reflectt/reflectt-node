// SPDX-License-Identifier: Apache-2.0
/**
 * Regression test: getNextTask should not surface tasks with a recent
 * handoff to another agent, even if the task is unassigned.
 *
 * This covers the claim-drift bug where rhythm kept pulling link-owned
 * tasks because the system cleared the assignee during handoff, making
 * them appear unassigned to any agent's /tasks/next.
 *
 * Task: task-1773172042306-3nrwabycc
 */
import { describe, it, expect, afterEach } from 'vitest'
import { taskManager } from '../src/tasks.js'

const CREATED: string[] = []

afterEach(() => {
  for (const id of CREATED) {
    try { taskManager.deleteTask(id) } catch {}
  }
  CREATED.length = 0
})

describe('getNextTask handoff filter', () => {
  it('does not surface tasks handed off to another agent', async () => {
    // Create a task that was handed off from rhythm to link
    const t = await taskManager.createTask({
      title: 'TEST: SMS relay — handed off to link',
      status: 'todo',
      assignee: 'unassigned', // cleared during transition
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'kai',
      metadata: {
        last_transition: {
          type: 'handoff',
          handoff_to: 'link',
          from_assignee: 'rhythm',
          to_assignee: 'link',
          reason: 'Backend task belongs to link lane',
        },
      },
    })
    CREATED.push(t.id)

    // rhythm should NOT get this task
    const rhythmNext = taskManager.getNextTask('rhythm')
    if (rhythmNext) {
      expect(rhythmNext.id).not.toBe(t.id)
    }

    // link SHOULD be able to get this task (not filtered out)
    // Use a unique agent name that matches 'link' via aliases, but since
    // there may be other tasks for link, just verify it's NOT excluded.
    // The real-world test: assign it directly to link and verify link gets it
    taskManager.updateTask(t.id, { assignee: 'link' })
    const linkNext = taskManager.getNextTask('link')
    expect(linkNext).toBeTruthy()
    // link should get either our task or another — the key is rhythm CANNOT
  })

  it('does not surface tasks with transition.handoff_to set to wrong agent', async () => {
    const t = await taskManager.createTask({
      title: 'TEST: task with transition handoff to spark',
      status: 'todo',
      assignee: 'unassigned',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'coo',
      metadata: {
        transition: {
          type: 'handoff',
          handoff_to: 'spark',
          reason: 'Growth task',
        },
      },
    })
    CREATED.push(t.id)

    // link should NOT get this task
    const linkNext = taskManager.getNextTask('link')
    if (linkNext) {
      expect(linkNext.id).not.toBe(t.id)
    }

    // rhythm should NOT get this task either
    const rhythmNext = taskManager.getNextTask('rhythm')
    if (rhythmNext) {
      expect(rhythmNext.id).not.toBe(t.id)
    }
  })

  it('does not exclude tasks without handoff metadata from any agent', async () => {
    const t = await taskManager.createTask({
      title: 'TEST: normal unassigned task no handoff',
      status: 'todo',
      assignee: 'unassigned',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'kai',
    })
    CREATED.push(t.id)

    // Verify the task exists in the candidate pool for rhythm
    // (it may not be the top result due to other tasks, but it must NOT be filtered out)
    // We test this by getting next for a unique agent name that has no other tasks
    const next = taskManager.getNextTask('testbot-' + Date.now())
    expect(next).toBeTruthy()
    // Our task should be pullable since it has no handoff metadata
    // and our unique agent has no other tasks, so it should be the result
    expect(next!.id).toBe(t.id)
  })
})
