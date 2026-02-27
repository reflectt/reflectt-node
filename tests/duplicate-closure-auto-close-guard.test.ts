// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { describe, it, expect } from 'vitest'
import { taskManager } from '../src/tasks.js'

describe('Duplicate closure canonical-ref enforcement (server-side)', () => {
  it('rejects closing a task as duplicate without canonical refs', async () => {
    const task = await taskManager.createTask({
      title: 'Test: duplicate closure guard',
      status: 'todo',
      assignee: 'link',
      reviewer: 'sage',
      createdBy: 'test',
      done_criteria: ['Has canonical refs'],
    })

    // Missing canonical_pr + canonical_commit
    await expect(
      taskManager.updateTask(task.id, {
        status: 'done',
        metadata: {
          auto_closed: true,
          auto_close_reason: 'duplicate',
          duplicate_of: 'task-0000000000000-abcdefg',
        },
      })
    ).rejects.toThrow(/canonical PR URL/i)

    // Canonical PR present but commit missing
    await expect(
      taskManager.updateTask(task.id, {
        status: 'done',
        metadata: {
          auto_closed: true,
          auto_close_reason: 'duplicate',
          duplicate_of: 'task-0000000000000-abcdefg',
          canonical_pr: 'https://github.com/reflectt/reflectt-node/pull/123',
        },
      })
    ).rejects.toThrow(/canonical_commit/i)

    // All canonical refs present
    const updated = await taskManager.updateTask(task.id, {
      status: 'done',
      metadata: {
        auto_closed: true,
        auto_close_reason: 'duplicate',
        duplicate_of: 'task-0000000000000-abcdefg',
        canonical_pr: 'https://github.com/reflectt/reflectt-node/pull/123',
        canonical_commit: 'abc1234',
      },
    })

    expect(updated?.status).toBe('done')
    expect((updated?.metadata as any)?.duplicate_of).toBe('task-0000000000000-abcdefg')
  })
})
