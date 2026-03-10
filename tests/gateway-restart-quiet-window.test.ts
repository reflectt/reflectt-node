// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { taskManager } from '../src/tasks.js'
import { policyManager } from '../src/policy.js'
import { BoardHealthWorker } from '../src/boardHealthWorker.js'

const TEST_AGENT = 'gw-restart-tester'
const TITLE_PREFIX = 'TEST: gw-restart-quiet'

describe('Gateway restart quiet window', () => {
  let originalReadyQueueFloor: any

  beforeEach(() => {
    originalReadyQueueFloor = policyManager.get().readyQueueFloor

    policyManager.patch({
      readyQueueFloor: {
        ...originalReadyQueueFloor,
        enabled: true,
        agents: [TEST_AGENT],
        minReady: 2,
        cooldownMin: 0,
        escalateAfterMin: 9999,
        channel: 'general',
      },
    } as any)
  })

  afterEach(() => {
    const tasks = taskManager.listTasks({ includeTest: true })
    for (const t of tasks) {
      if (t.title.startsWith(TITLE_PREFIX)) {
        taskManager.deleteTask(t.id)
      }
    }
    policyManager.patch({ readyQueueFloor: originalReadyQueueFloor } as any)
  })

  it('resetQuietWindow() suppresses alerts for agents with no prior alert record', async () => {
    // No tasks → agent is below floor (minReady=2), no active work → breach
    const worker = new BoardHealthWorker({ maxActionsPerTick: 0, restartQuietWindowMs: 5_000 })

    // Simulate gateway restart → reset quiet window
    worker.resetQuietWindow()

    // Tick should NOT produce ready-queue-floor breach actions during quiet window
    const result = await worker.tick({ dryRun: true, force: true })
    const rqfActions = result.actions.filter(a => a.kind === 'ready-queue-warning' && a.agent === TEST_AGENT)
    expect(rqfActions.length).toBe(0)
    worker.stop()
  })

  it('alerts fire after quiet window expires', async () => {
    // 1ms quiet window → expires almost immediately
    const worker = new BoardHealthWorker({ maxActionsPerTick: 0, restartQuietWindowMs: 1 })

    worker.resetQuietWindow()
    await new Promise(r => setTimeout(r, 10))

    // Quiet window expired, no tasks → breach alert should fire
    // Note: dryRun=false because breach actions only push to actions[] in isBreach path
    // and readyQueueLastAlertAt needs to be set for the action to be recorded
    const result = await worker.tick({ force: true })
    const rqfActions = result.actions.filter(a => a.kind === 'ready-queue-warning' && a.agent === TEST_AGENT)
    expect(rqfActions.length).toBeGreaterThan(0)
    worker.stop()
  })

  it('resetQuietWindow() can be called multiple times (re-suppresses)', async () => {
    const worker = new BoardHealthWorker({ maxActionsPerTick: 0, restartQuietWindowMs: 5_000 })

    worker.resetQuietWindow()
    let result = await worker.tick({ dryRun: true, force: true })
    let rqfActions = result.actions.filter(a => a.kind === 'ready-queue-warning' && a.agent === TEST_AGENT)
    expect(rqfActions.length).toBe(0)

    // Second reset
    worker.resetQuietWindow()
    result = await worker.tick({ dryRun: true, force: true })
    rqfActions = result.actions.filter(a => a.kind === 'ready-queue-warning' && a.agent === TEST_AGENT)
    expect(rqfActions.length).toBe(0)

    worker.stop()
  })
})
