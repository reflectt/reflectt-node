// SPDX-License-Identifier: Apache-2.0
// Ready-queue engine v1 tests
// Proves: (a) lane below floor triggers task creation, (b) WIP limit blocks pulls.

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { taskManager } from '../src/tasks.js'
import { BoardHealthWorker } from '../src/boardHealthWorker.js'
import { DEFAULT_LANES, checkWipLimit, getLanesConfig } from '../src/lane-config.js'

// Use a test agent from DEFAULT_LANES so lane config is deterministic in tests
const TEST_AGENT = 'link'
const TEST_LANE = DEFAULT_LANES.find(l => l.agents.includes(TEST_AGENT))!

describe('Ready-queue engine v1', () => {
  // Track tasks created during each test for cleanup
  const createdTaskIds: string[] = []

  afterEach(() => {
    for (const id of createdTaskIds) {
      try { taskManager.deleteTask(id) } catch { /* ok */ }
    }
    createdTaskIds.length = 0
  })

  // ── Lane config ─────────────────────────────────────────────────────────

  it('getLanesConfig returns DEFAULT_LANES in test environment', () => {
    const lanes = getLanesConfig()
    expect(lanes).toBeDefined()
    expect(lanes.length).toBeGreaterThan(0)
    // In tests VITEST=true so we always get defaults
    expect(lanes).toEqual(DEFAULT_LANES)
  })

  it('DEFAULT_LANES have required fields', () => {
    for (const lane of DEFAULT_LANES) {
      expect(typeof lane.name).toBe('string')
      expect(lane.agents.length).toBeGreaterThan(0)
      expect(typeof lane.readyFloor).toBe('number')
      expect(typeof lane.wipLimit).toBe('number')
    }
  })

  // ── (a) Sweeper: lane below floor triggers task creation ─────────────────

  it('sweeper creates placeholder tasks when agent is below readyFloor', async () => {
    // Ensure no pre-existing todo tasks for test agent interfere
    const existingTodo = taskManager.listTasks({ status: 'todo', assignee: TEST_AGENT })
    // Delete only tasks we created in prior test runs (TEST: prefix)
    const prior = existingTodo.filter(t => t.title?.startsWith('[Auto] Ready queue replenish:'))
    for (const t of prior) {
      taskManager.deleteTask(t.id)
    }

    // Count current unblocked todo tasks for this agent
    const beforeTodo = taskManager.listTasks({ status: 'todo', assignee: TEST_AGENT })
      .filter(t => !(t.metadata?.auto_created))

    // Only run the sweeper test when the agent is below floor.
    // If the agent already has >= readyFloor todo tasks, skip.
    const unblockedBefore = beforeTodo.filter(t => {
      const blocked = t.metadata?.blocked_by
      if (!blocked) return true
      const blocker = taskManager.getTask(blocked as string)
      return !blocker || blocker.status === 'done'
    })

    if (unblockedBefore.length >= TEST_LANE.readyFloor) {
      // Agent already above floor — delete some to simulate below-floor state
      for (let i = 0; i < unblockedBefore.length - TEST_LANE.readyFloor + 1; i++) {
        taskManager.deleteTask(unblockedBefore[i].id)
        createdTaskIds.push(unblockedBefore[i].id) // mark for re-cleanup
      }
    }

    const worker = new BoardHealthWorker({ enabled: false, dryRun: false })
    const result = await worker.tick({ force: true, dryRun: false })

    const replenishActions = result.actions.filter(a => a.kind === 'ready-queue-replenish')
    expect(replenishActions.length).toBeGreaterThan(0)

    // Check that at least one was for our test agent
    const agentAction = replenishActions.find(a => a.agent === TEST_AGENT)
    expect(agentAction).toBeDefined()
    expect(agentAction?.taskId).toBeDefined()

    // Verify the task exists in taskManager
    if (agentAction?.taskId) {
      const created = taskManager.getTask(agentAction.taskId)
      expect(created).toBeDefined()
      expect(created?.title).toBe(`[Auto] Ready queue replenish: ${TEST_LANE.name}`)
      expect(created?.status).toBe('todo')
      expect(created?.assignee).toBe(TEST_AGENT)
      expect(created?.metadata?.auto_created).toBe(true)
      createdTaskIds.push(agentAction.taskId)
    }
  })

  it('sweeper does NOT create tasks when agent is at or above readyFloor', async () => {
    // Create enough todo tasks to meet the floor
    for (let i = 0; i < TEST_LANE.readyFloor; i++) {
      const t = await taskManager.createTask({
        title: `TEST: sweeper-guard task ${i}`,
        status: 'todo',
        assignee: TEST_AGENT,
        createdBy: 'test',
        done_criteria: ['done'],
      })
      createdTaskIds.push(t.id)
    }

    const worker = new BoardHealthWorker({ enabled: false, dryRun: false })
    const result = await worker.tick({ force: true, dryRun: false })

    const agentReplenish = result.actions.filter(
      a => a.kind === 'ready-queue-replenish' && a.agent === TEST_AGENT,
    )
    expect(agentReplenish.length).toBe(0)
  })

  // ── (b) WIP enforcement: limit blocks pulls ──────────────────────────────

  it('checkWipLimit returns null for unknown agent (no limit)', () => {
    const result = checkWipLimit('unknown-agent-xyz', 99)
    expect(result).toBeNull()
  })

  it('checkWipLimit returns not-blocked when under limit', () => {
    const result = checkWipLimit(TEST_AGENT, 0)
    expect(result).not.toBeNull()
    expect(result!.blocked).toBe(false)
    expect(result!.wipLimit).toBe(TEST_LANE.wipLimit)
    expect(result!.doing).toBe(0)
  })

  it('checkWipLimit returns blocked when at wipLimit', () => {
    const result = checkWipLimit(TEST_AGENT, TEST_LANE.wipLimit)
    expect(result).not.toBeNull()
    expect(result!.blocked).toBe(true)
    expect(result!.wipLimit).toBe(TEST_LANE.wipLimit)
    expect(result!.doing).toBe(TEST_LANE.wipLimit)
    expect(result!.message).toContain('WIP limit reached')
    expect(result!.message).toContain(`${TEST_LANE.wipLimit}/${TEST_LANE.wipLimit}`)
  })

  it('checkWipLimit returns blocked when over wipLimit', () => {
    const result = checkWipLimit(TEST_AGENT, TEST_LANE.wipLimit + 1)
    expect(result!.blocked).toBe(true)
  })

  it('/tasks/next returns WIP-limit error when agent is at limit', async () => {
    const { createServer } = await import('../src/server.js')
    const app = await createServer()

    // Account for any existing doing tasks (imported from data/tasks.jsonl)
    const existingDoing = taskManager.listTasks({ status: 'doing', assignee: TEST_AGENT })
    const needed = Math.max(0, TEST_LANE.wipLimit - existingDoing.length)

    // Create additional doing tasks to reach the WIP limit
    for (let i = 0; i < needed; i++) {
      const t = await taskManager.createTask({
        title: `TEST: wip-limit doing task ${i}`,
        status: 'doing',
        assignee: TEST_AGENT,
        reviewer: 'sage',
        createdBy: 'test',
        done_criteria: ['done'],
      })
      createdTaskIds.push(t.id)
    }

    const res = await app.inject({
      method: 'GET',
      url: `/tasks/next?agent=${TEST_AGENT}`,
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.task).toBeNull()
    expect(body.wipLimit).toBe(TEST_LANE.wipLimit)
    expect(body.doing).toBeGreaterThanOrEqual(TEST_LANE.wipLimit)
    expect(body.message).toContain('WIP limit reached')
  })

  it('/tasks/next skips WIP check for agents not in any lane', async () => {
    // An agent not in any configured lane has no WIP limit — pull should not return wipLimit
    const { createServer } = await import('../src/server.js')
    const app = await createServer()

    const res = await app.inject({
      method: 'GET',
      url: '/tasks/next?agent=unknown-test-agent-xyz',
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    // WIP check is not applied for unlisted agents
    expect(body.wipLimit).toBeUndefined()
  })
})
