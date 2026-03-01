// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { taskManager } from '../src/tasks.js'
import { policyManager } from '../src/policy.js'
import { BoardHealthWorker } from '../src/boardHealthWorker.js'
import { presenceManager } from '../src/presence.js'

const TEST_AGENT = 'rqf-tester'
const TITLE_PREFIX = 'TEST: rqf-breach-semantics'

// Register test agent presence so sweeper doesn't skip it as a ghost
presenceManager.updatePresence(TEST_AGENT, 'online')

describe('Ready-Queue Floor (breach semantics)', () => {
  let originalReadyQueueFloor: any

  beforeEach(() => {
    originalReadyQueueFloor = policyManager.get().readyQueueFloor

    // Isolate this test from any default/other agents.
    policyManager.patch({
      readyQueueFloor: {
        ...originalReadyQueueFloor,
        enabled: true,
        agents: [TEST_AGENT],
        minReady: 2,
        cooldownMin: 0,
        // Keep idle escalation out of the way unless the test explicitly enables it.
        escalateAfterMin: 9999,
        channel: 'general',
      },
    } as any)
  })

  afterEach(() => {
    // Cleanup tasks created in this suite
    for (const t of taskManager.listTasks({ assignee: TEST_AGENT })) {
      if ((t.title || '').startsWith(TITLE_PREFIX)) {
        taskManager.deleteTask(t.id)
      }
    }

    // Restore policy
    policyManager.patch({ readyQueueFloor: originalReadyQueueFloor } as any)
  })

  it('does NOT emit a ready-queue breach when the agent is active via validating-only queue', async () => {
    taskManager.createTask({
      title: `${TITLE_PREFIX}: validating-only`,
      assignee: TEST_AGENT,
      status: 'validating',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'sage',
      metadata: { artifact_path: 'process/TASK-test.md' },
    })

    const worker = new BoardHealthWorker({ maxActionsPerTick: 0 })
    const { actions } = await worker.tick({ dryRun: true, force: true })

    expect(actions.some(a => a.kind === 'ready-queue-warning')).toBe(false)
    expect(actions.some(a => a.kind === 'idle-queue-escalation')).toBe(false)
  })

  it('DOES emit a ready-queue breach when below floor and no doing/validating tasks exist', async () => {
    // No tasks created for TEST_AGENT → below floor AND inactive.
    const worker = new BoardHealthWorker({ maxActionsPerTick: 0 })
    const { actions } = await worker.tick({ dryRun: true, force: true })

    expect(actions.some(a => a.kind === 'ready-queue-warning' && a.agent === TEST_AGENT)).toBe(true)
  })

  it('does NOT treat validating-only queue as idle for idle escalation', async () => {
    // Enable immediate escalation
    policyManager.patch({ readyQueueFloor: { escalateAfterMin: 0, cooldownMin: 0 } } as any)

    taskManager.createTask({
      title: `${TITLE_PREFIX}: validating-only (idle check)`,
      assignee: TEST_AGENT,
      status: 'validating',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'sage',
      metadata: { artifact_path: 'process/TASK-test.md' },
    })

    const worker = new BoardHealthWorker({ maxActionsPerTick: 0 })
    const { actions } = await worker.tick({ dryRun: true, force: true })

    expect(actions.some(a => a.kind === 'idle-queue-escalation' && a.agent === TEST_AGENT)).toBe(false)
  })
})
