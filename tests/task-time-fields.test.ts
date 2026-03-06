// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { describe, it, expect } from 'vitest'
import { taskManager } from '../src/tasks.js'

describe('Task time fields (dueAt / scheduledFor)', () => {
  const now = Date.now()

  it('creates a task with dueAt and scheduledFor', async () => {
    const dueAt = now + 86400000 // +24h
    const scheduledFor = now + 3600000 // +1h

    const task = await taskManager.createTask({
      title: 'TEST: time-fields create test',
      createdBy: 'test',
      status: 'todo',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      done_criteria: ['verify dueAt persists'],
      dueAt,
      scheduledFor,
      metadata: { is_test: true, reflection_exempt: true, reflection_exempt_reason: 'test' },
    })

    expect(task.dueAt).toBe(dueAt)
    expect(task.scheduledFor).toBe(scheduledFor)

    // Verify it persists through a read
    const fetched = taskManager.getTask(task.id)
    expect(fetched).toBeDefined()
    expect(fetched!.dueAt).toBe(dueAt)
    expect(fetched!.scheduledFor).toBe(scheduledFor)
  })

  it('updates dueAt on an existing task', async () => {
    const task = await taskManager.createTask({
      title: 'TEST: time-fields update test',
      createdBy: 'test',
      status: 'todo',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      done_criteria: ['verify dueAt update'],
      metadata: { is_test: true, reflection_exempt: true, reflection_exempt_reason: 'test' },
    })

    expect(task.dueAt).toBeUndefined()

    const newDueAt = now + 172800000 // +48h
    const updated = await taskManager.updateTask(task.id, { dueAt: newDueAt })
    expect(updated).toBeDefined()
    expect(updated!.dueAt).toBe(newDueAt)

    // Verify persistence
    const fetched = taskManager.getTask(task.id)
    expect(fetched!.dueAt).toBe(newDueAt)
  })

  it('clears dueAt by setting null', async () => {
    const dueAt = now + 86400000
    const task = await taskManager.createTask({
      title: 'TEST: time-fields clear test',
      createdBy: 'test',
      status: 'todo',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      done_criteria: ['verify dueAt clear'],
      dueAt,
      metadata: { is_test: true, reflection_exempt: true, reflection_exempt_reason: 'test' },
    })

    expect(task.dueAt).toBe(dueAt)

    const updated = await taskManager.updateTask(task.id, { dueAt: null as unknown as undefined })
    expect(updated).toBeDefined()
    // After clearing, dueAt should be falsy (null or undefined)
    expect(updated!.dueAt).toBeFalsy()

    // On re-read from DB, null maps to undefined
    const fetched = taskManager.getTask(task.id)
    expect(fetched!.dueAt).toBeUndefined()
  })

  it('task without time fields works normally', async () => {
    const task = await taskManager.createTask({
      title: 'TEST: time-fields absent test',
      createdBy: 'test',
      status: 'todo',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      done_criteria: ['verify no regression'],
      metadata: { is_test: true, reflection_exempt: true, reflection_exempt_reason: 'test' },
    })

    expect(task.dueAt).toBeUndefined()
    expect(task.scheduledFor).toBeUndefined()
    expect(task.id).toBeTruthy()
    expect(task.title).toBe('TEST: time-fields absent test')
  })
})
