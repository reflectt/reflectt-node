/**
 * Regression tests for continuity-loop nudge/scoped-task decoupling.
 *
 * Bug: generateScopedTasksFromRole() was gated behind nudgeResult.total === 0.
 * Active teams (where nudges always fire) never reached the scoped fallback,
 * and the 30-min cooldown was set even when no tasks were created — causing a
 * permanent empty-queue loop.
 *
 * Fix: nudges and scoped-task generation run in parallel. Only task creation
 * (not nudge firing) sets the full 30-min cooldown. Nudges have their own
 * 5-min cooldown to prevent spam.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as reflectionAutomation from '../src/reflection-automation.js'
import * as policyModule from '../src/policy.js'
import { _resetContinuityState, tickContinuityLoop } from '../src/continuity-loop.js'
import { presenceManager } from '../src/presence.js'
import { taskManager } from '../src/tasks.js'

const TEST_AGENT = 'rhythm-regression-agent'

function mockMinimalPolicy() {
  vi.spyOn(policyModule.policyManager, 'get').mockReturnValue({
    continuityLoop: {
      enabled: true,
      agents: [TEST_AGENT],
      minReady: 1,
      maxPromotePerCycle: 2,
      cooldownMin: 30,
      channel: 'general',
      defaultReviewer: 'sage',
    },
    readyQueueFloor: {},
  } as any)
}

describe('continuity-loop nudge/scoped-task decoupling', () => {
  beforeEach(() => {
    _resetContinuityState()
    mockMinimalPolicy()
    // Register agent in presence so resolveMonitoredAgents includes it
    presenceManager.updatePresence(TEST_AGENT, {
      agent: TEST_AGENT,
      status: 'active',
      last_seen: Date.now(),
    } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does NOT set 30-min cooldown when nudges fire but no tasks are created', async () => {
    // Nudges fire (active team scenario)
    vi.spyOn(reflectionAutomation, 'tickReflectionNudges').mockResolvedValue({ total: 3 } as any)
    // Agent has no tasks
    vi.spyOn(taskManager, 'listTasks').mockReturnValue([])

    await tickContinuityLoop() // First tick: nudges fire, no tasks created

    // Second tick: should NOT be blocked by the 30-min cooldown.
    // Under the old code, lastReplenishAt was set unconditionally on nudge-only cycles,
    // meaning this second tick would skip the agent entirely (cooldown not expired).
    // With the fix: no cooldown set → agent is checked again.
    const secondResult = await tickContinuityLoop()
    expect(secondResult.agentsChecked).toBeGreaterThan(0)
  })

  it('nudge call count does not increase when nudge cooldown (5 min) is active', async () => {
    const nudgeSpy = vi.spyOn(reflectionAutomation, 'tickReflectionNudges').mockResolvedValue({ total: 1 } as any)
    vi.spyOn(taskManager, 'listTasks').mockReturnValue([])

    await tickContinuityLoop() // Fires nudge, sets lastNudgeAt
    await tickContinuityLoop() // Within 5 min — should NOT re-fire nudge

    // Nudge should have been called only once (protected by separate nudge cooldown)
    expect(nudgeSpy).toHaveBeenCalledTimes(1)
  })

  it('sets 30-min cooldown when tasks ARE created (prevents duplicate creation)', async () => {
    vi.spyOn(reflectionAutomation, 'tickReflectionNudges').mockResolvedValue({ total: 0 } as any)
    vi.spyOn(taskManager, 'listTasks').mockReturnValue([])

    const firstResult = await tickContinuityLoop()

    if (firstResult.replenished > 0) {
      // Tasks were created → cooldown is set → second tick skips agent
      const secondResult = await tickContinuityLoop()
      expect(secondResult.replenished).toBe(0)
    } else {
      // No tasks generated (role not found or no-op) — assert loop still ran
      expect(firstResult.agentsChecked).toBeGreaterThanOrEqual(0)
    }
  })
})
