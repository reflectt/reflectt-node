// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { describe, it, expect } from 'vitest'
import { taskManager } from '../src/tasks.js'

describe('Duplicate closure canonical proof enforcement (server-side)', () => {
  it('rejects duplicate_of only (missing proof and pr/commit)', async () => {
    const task = await taskManager.createTask({
      title: 'Test: duplicate closure guard',
      status: 'todo',
      assignee: 'link',
      reviewer: 'sage',
      createdBy: 'test',
      done_criteria: ['Has canonical duplicate closure proof'],
    })

    await expect(
      taskManager.updateTask(task.id, {
        status: 'done',
        metadata: {
          auto_closed: true,
          auto_close_reason: 'duplicate',
          duplicate_of: 'task-0000000000000-abcdefg',
        },
      })
    ).rejects.toThrow(/duplicate_proof/i)
  })

  it('accepts duplicate_of + proof + canonical_pr', async () => {
    const task = await taskManager.createTask({
      title: 'Test: duplicate closure guard (pr)',
      status: 'todo',
      assignee: 'link',
      reviewer: 'sage',
      createdBy: 'test',
      done_criteria: ['Has canonical duplicate closure proof'],
    })

    const updated = await taskManager.updateTask(task.id, {
      status: 'done',
      metadata: {
        auto_closed: true,
        auto_close_reason: 'duplicate',
        duplicate_of: 'task-0000000000000-abcdefg',
        duplicate_proof: 'Duplicate of task-0000000000000-abcdefg — already fixed in PR #123',
        canonical_pr: 'https://github.com/reflectt/reflectt-node/pull/123',
      },
    })

    expect(updated?.status).toBe('done')
  })

  it('accepts duplicate_of + proof + canonical_commit', async () => {
    const task = await taskManager.createTask({
      title: 'Test: duplicate closure guard (commit)',
      status: 'todo',
      assignee: 'link',
      reviewer: 'sage',
      createdBy: 'test',
      done_criteria: ['Has canonical duplicate closure proof'],
    })

    const updated = await taskManager.updateTask(task.id, {
      status: 'done',
      metadata: {
        auto_closed: true,
        auto_close_reason: 'duplicate',
        duplicate_of: 'task-0000000000000-abcdefg',
        duplicate_proof: 'Duplicate of task-0000000000000-abcdefg — already fixed in commit abc1234',
        canonical_commit: 'abc1234',
      },
    })

    expect(updated?.status).toBe('done')
  })
})
