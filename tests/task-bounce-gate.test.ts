// SPDX-License-Identifier: Apache-2.0
// Task bounce gate tests
//
// Proves: when a task bounces from validating back to doing,
// bounce_count increments in metadata. On the 3rd bounce (bounce_count >= 2),
// a documented reason is required.

import { describe, it, expect, afterEach } from 'vitest'
import { taskManager } from '../src/tasks.js'

describe('Task bounce gate (validating → doing)', () => {
  const createdIds: string[] = []

  afterEach(() => {
    for (const id of createdIds) {
      try { taskManager.deleteTask(id) } catch { /* ok */ }
    }
    createdIds.length = 0
  })

  async function createValidatingTask(): Promise<string> {
    const task = await taskManager.createTask({
      title: 'TEST: bounce gate task',
      status: 'todo',
      assignee: 'forge',
      reviewer: 'kai',
      createdBy: 'test',
      done_criteria: ['Feature shipped'],
      metadata: {
        eta: '~1h',
        reflection_exempt: true,
        reflection_exempt_reason: 'test fixture',
      },
    })
    createdIds.push(task.id)

    // Move to doing
    await taskManager.updateTask(task.id, { status: 'doing' })

    // Move to validating (requires artifact_path)
    await taskManager.updateTask(task.id, {
      status: 'validating',
      metadata: {
        eta: '~1h',
        artifact_path: 'process/TEST-bounce.md',
        qa_bundle: {
          lane: 'eng',
          summary: 'done',
          review_packet: {
            task_id: task.id,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
            commit: 'abc1234',
            changed_files: ['src/tasks.ts'],
            artifact_path: 'process/TEST-bounce.md',
            caveats: 'none',
          },
        },
        review_handoff: {
          task_id: task.id,
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
          commit_sha: 'abc1234',
          artifact_path: 'process/TEST-bounce.md',
          known_caveats: 'none',
        },
        reflection_exempt: true,
        reflection_exempt_reason: 'test fixture',
      },
    })

    return task.id
  }

  it('bounce 1: increments bounce_count to 1, no reason required', async () => {
    const id = await createValidatingTask()

    // First bounce: validating → doing
    await taskManager.updateTask(id, { status: 'doing' })

    const updated = taskManager.listTasks({}).find(t => t.id === id)
    expect(updated?.metadata?.bounce_count).toBe(1)
    expect(updated?.metadata?.last_bounce_at).toBeTypeOf('number')
    expect(updated?.status).toBe('doing')
  })

  it('bounce 2: increments bounce_count to 2, still no reason required', async () => {
    const id = await createValidatingTask()

    // First bounce
    await taskManager.updateTask(id, { status: 'doing' })

    // Move back to validating
    await taskManager.updateTask(id, {
      status: 'validating',
      metadata: {
        eta: '~1h',
        artifact_path: 'process/TEST-bounce.md',
        bounce_count: 1, // carry forward
        qa_bundle: {
          lane: 'eng',
          summary: 'done',
          review_packet: {
            task_id: id,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
            commit: 'abc1234',
            changed_files: ['src/tasks.ts'],
            artifact_path: 'process/TEST-bounce.md',
            caveats: 'none',
          },
        },
        review_handoff: {
          task_id: id,
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
          commit_sha: 'abc1234',
          artifact_path: 'process/TEST-bounce.md',
          known_caveats: 'none',
        },
        reflection_exempt: true,
        reflection_exempt_reason: 'test fixture',
      },
    })

    // Second bounce: no reason needed yet
    await taskManager.updateTask(id, { status: 'doing' })

    const updated = taskManager.listTasks({}).find(t => t.id === id)
    expect(updated?.metadata?.bounce_count).toBe(2)
  })

  it('bounce 3+: requires documented reason (throws without it)', async () => {
    const id = await createValidatingTask()

    // Artificially set bounce_count to 2 (simulating 2 previous bounces)
    await taskManager.patchTaskMetadata(id, { bounce_count: 2 })

    // Move back to validating
    await taskManager.updateTask(id, {
      status: 'validating',
      metadata: {
        eta: '~1h',
        artifact_path: 'process/TEST-bounce.md',
        bounce_count: 2,
        qa_bundle: {
          lane: 'eng',
          summary: 'done',
          review_packet: {
            task_id: id,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
            commit: 'abc1234',
            changed_files: ['src/tasks.ts'],
            artifact_path: 'process/TEST-bounce.md',
            caveats: 'none',
          },
        },
        review_handoff: {
          task_id: id,
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
          commit_sha: 'abc1234',
          artifact_path: 'process/TEST-bounce.md',
          known_caveats: 'none',
        },
        reflection_exempt: true,
        reflection_exempt_reason: 'test fixture',
      },
    })

    // 3rd bounce: should throw without reason
    await expect(
      taskManager.updateTask(id, { status: 'doing' })
    ).rejects.toThrow(/Bounce gate/)
  })

  it('bounce 3+: succeeds when reason is provided', async () => {
    const id = await createValidatingTask()

    // Artificially set bounce_count to 2
    await taskManager.patchTaskMetadata(id, { bounce_count: 2 })

    // Move back to validating
    await taskManager.updateTask(id, {
      status: 'validating',
      metadata: {
        eta: '~1h',
        artifact_path: 'process/TEST-bounce.md',
        bounce_count: 2,
        qa_bundle: {
          lane: 'eng',
          summary: 'done',
          review_packet: {
            task_id: id,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
            commit: 'abc1234',
            changed_files: ['src/tasks.ts'],
            artifact_path: 'process/TEST-bounce.md',
            caveats: 'none',
          },
        },
        review_handoff: {
          task_id: id,
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
          commit_sha: 'abc1234',
          artifact_path: 'process/TEST-bounce.md',
          known_caveats: 'none',
        },
        reflection_exempt: true,
        reflection_exempt_reason: 'test fixture',
      },
    })

    // 3rd bounce with documented reason: should succeed
    await expect(
      taskManager.updateTask(id, {
        status: 'doing',
        metadata: {
          transition: {
            type: 'bounce_back',
            reason: 'Reviewer found edge case in auth flow — need to revisit token refresh logic',
          },
        },
      })
    ).resolves.toBeDefined()

    const updated = taskManager.listTasks({}).find(t => t.id === id)
    expect(updated?.metadata?.bounce_count).toBe(3)
    expect(updated?.status).toBe('doing')
  })

  it('pulse surfaces high-bounce tasks', async () => {
    const id = await createValidatingTask()

    // Set bounce_count = 2 directly
    await taskManager.patchTaskMetadata(id, { bounce_count: 2 })

    const { generatePulse } = await import('../src/pulse.js')
    const pulse = generatePulse()

    const bounced = pulse.highBounceTasks?.find(t => t.taskId === id)
    expect(bounced).toBeDefined()
    expect(bounced?.bounceCount).toBe(2)
  })
})
