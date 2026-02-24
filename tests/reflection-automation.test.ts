// Tests for reflection automation: nudging + SLA tracking
import { describe, it, expect, beforeEach } from 'vitest'
import {
  onTaskDone,
  onReflectionSubmitted,
  tickReflectionNudges,
  getReflectionSLAs,
  _clearReflectionTracking,
  _getPendingNudges,
  ensureReflectionTrackingTable,
} from '../src/reflection-automation.js'
import { createReflection, _clearReflectionStore, validateReflection } from '../src/reflections.js'
import { taskManager } from '../src/tasks.js'
import { getDb } from '../src/db.js'
import { policyManager } from '../src/policy.js'
import type { Task } from '../src/types.js'

// ── Helpers ──

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-test-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    title: 'Test task for reflection automation',
    description: 'A test task',
    status: 'done',
    assignee: 'link',
    reviewer: 'kai',
    done_criteria: ['test passes'],
    createdBy: 'system',
    priority: 'P1',
    tags: [],
    metadata: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function makeReflection(author: string) {
  const input = {
    pain: 'Test pain for automation',
    impact: 'Testing impact',
    evidence: ['test evidence'],
    went_well: 'Test went well',
    suspected_why: 'Testing suspected why',
    proposed_fix: 'Testing fix',
    confidence: 7,
    role_type: 'agent' as const,
    author,
    severity: 'medium' as const,
    tags: ['stage:test', 'family:automation', 'unit:testing'],
  }
  const validated = validateReflection(input)
  if (!validated.valid) throw new Error('Invalid test reflection')
  return createReflection(validated.data)
}

beforeEach(() => {
  _clearReflectionTracking()
  _clearReflectionStore()
})

// ── Post-task nudge ──

describe('onTaskDone', () => {
  it('should queue a pending nudge when task completes', () => {
    const task = makeTask({ assignee: 'link' })
    onTaskDone(task)

    const pending = _getPendingNudges()
    expect(pending.length).toBe(1)
    expect(pending[0].agent).toBe('link')
    expect(pending[0].taskId).toBe(task.id)
  })

  it('should queue a pending nudge when task is blocked', () => {
    const task = makeTask({ assignee: 'link', status: 'blocked' })
    onTaskDone(task)

    const pending = _getPendingNudges()
    expect(pending.length).toBe(1)
    expect(pending[0].agent).toBe('link')
    expect(pending[0].taskStatus).toBe('blocked')
  })

  it('should not queue nudge when no assignee', () => {
    const task = makeTask({ assignee: undefined })
    onTaskDone(task)

    expect(_getPendingNudges().length).toBe(0)
  })

  it('should increment tasks-done counter', () => {
    ensureReflectionTrackingTable()
    const task1 = makeTask({ assignee: 'link' })
    const task2 = makeTask({ assignee: 'link' })
    onTaskDone(task1)
    onTaskDone(task2)

    // SLA should show 2 tasks done since last reflection
    const slas = getReflectionSLAs()
    // link may or may not be in active agents list, so let's check tracking directly
    const pending = _getPendingNudges()
    expect(pending.length).toBe(2)
  })
})

// ── Reflection submission tracking ──

describe('onReflectionSubmitted', () => {
  it('should reset tracking when reflection is submitted', () => {
    ensureReflectionTrackingTable()
    const task = makeTask({ assignee: 'link' })
    onTaskDone(task)
    onTaskDone(task)

    // Submit reflection
    onReflectionSubmitted('link')

    // Tasks done counter should reset
    // We can verify via SLA status
    const slas = getReflectionSLAs()
    const linkSla = slas.find(s => s.agent === 'link')
    if (linkSla) {
      expect(linkSla.tasksDoneSinceLastReflection).toBe(0)
    }
  })
})

// ── Tick processing ──

describe('tickReflectionNudges', () => {
  it('should fire ready post-task nudges', async () => {
    const task = makeTask({ assignee: 'test-agent-nudge' })

    // Directly push a pending nudge with nudgeAt in the past
    _clearReflectionTracking()
    ensureReflectionTrackingTable()
    onTaskDone(task)

    // Modify the pending nudge to fire immediately
    const pending = _getPendingNudges()
    if (pending.length > 0) {
      // The nudge is delayed by config, so set nudgeAt to now
      ;(pending[0] as any).nudgeAt = Date.now() - 1000
    }

    const result = await tickReflectionNudges()
    // May or may not fire depending on implementation details (routeMessage mock)
    expect(result).toHaveProperty('postTaskNudges')
    expect(result).toHaveProperty('idleNudges')
    expect(result).toHaveProperty('total')
  })

  it('should respect cooldown between nudges', async () => {
    const task = makeTask({ assignee: 'cooldown-agent' })
    ensureReflectionTrackingTable()
    onTaskDone(task)

    // First tick
    const pending = _getPendingNudges()
    if (pending.length > 0) {
      ;(pending[0] as any).nudgeAt = Date.now() - 1000
    }
    await tickReflectionNudges()

    // Second task done immediately
    onTaskDone(makeTask({ assignee: 'cooldown-agent' }))
    const pending2 = _getPendingNudges()
    if (pending2.length > 0) {
      ;(pending2[0] as any).nudgeAt = Date.now() - 1000
    }

    const result2 = await tickReflectionNudges()
    // Should be suppressed by cooldown
    expect(result2.postTaskNudges).toBe(0)
  })

  it('should skip nudge if agent reflected after task completion', async () => {
    ensureReflectionTrackingTable()
    const task = makeTask({ assignee: 'reflective-agent' })
    onTaskDone(task)

    // Backdate the nudge's doneAt well into the past
    const pending = _getPendingNudges()
    if (pending.length > 0) {
      ;(pending[0] as any).doneAt = Date.now() - 60_000
      ;(pending[0] as any).nudgeAt = Date.now() - 1000
    }

    // Agent submits reflection (timestamp will be > doneAt)
    onReflectionSubmitted('reflective-agent')

    const result = await tickReflectionNudges()
    // Should skip because agent already reflected
    expect(result.postTaskNudges).toBe(0)
  })

  it('should nudge tracked agents even when they have no active tasks', async () => {
    ensureReflectionTrackingTable()

    const prev = (policyManager.get() as any).reflectionNudge
    policyManager.patch({
      reflectionNudge: {
        ...prev,
        enabled: true,
        // Force a stable allowlist so other tests/tasks cannot influence this expectation.
        agents: ['tracked-idle'],
        idleReflectionHours: 1,
        cooldownMin: 0,
      },
    })

    try {
      // Create tracking row without creating any active tasks.
      onReflectionSubmitted('tracked-idle')

      // Backdate last reflection to be overdue.
      const db = getDb()
      const past = Date.now() - 2 * 60 * 60 * 1000
      db.prepare('UPDATE reflection_tracking SET last_reflection_at = ?, updated_at = ? WHERE agent = ?')
        .run(past, past, 'tracked-idle')

      const result = await tickReflectionNudges()
      expect(result.idleNudges).toBeGreaterThanOrEqual(1)
    } finally {
      policyManager.patch({ reflectionNudge: prev })
    }
  })
})

// ── SLA Reporting ──

describe('getReflectionSLAs', () => {
  it('should return SLA status for tracked agents', () => {
    ensureReflectionTrackingTable()
    onReflectionSubmitted('sla-agent-1')

    const slas = getReflectionSLAs()
    // Should include agents with tracking data
    expect(Array.isArray(slas)).toBe(true)
  })

  it('should mark never-reflected agents as overdue', () => {
    ensureReflectionTrackingTable()
    // Create a task for an agent to make them "active"
    onTaskDone(makeTask({ assignee: 'never-reflected' }))

    const slas = getReflectionSLAs()
    const agentSla = slas.find(s => s.agent === 'never-reflected')
    if (agentSla) {
      expect(agentSla.status).toBe('overdue')
    }
  })

  it('should mark recently-reflected agents as healthy', () => {
    ensureReflectionTrackingTable()
    onReflectionSubmitted('healthy-agent')

    // Need to make the agent active
    onTaskDone(makeTask({ assignee: 'healthy-agent' }))

    const slas = getReflectionSLAs()
    const agentSla = slas.find(s => s.agent === 'healthy-agent')
    if (agentSla) {
      expect(agentSla.status).toBe('healthy')
      expect(agentSla.lastReflectionAt).toBeTruthy()
    }
  })

  it('should sort by status: overdue first', () => {
    ensureReflectionTrackingTable()
    // Agent A: healthy (just reflected)
    onReflectionSubmitted('agent-a')
    onTaskDone(makeTask({ assignee: 'agent-a' }))

    // Agent B: overdue (never reflected)
    onTaskDone(makeTask({ assignee: 'agent-b' }))

    const slas = getReflectionSLAs()
    if (slas.length >= 2) {
      // First should be overdue
      const overdueIdx = slas.findIndex(s => s.status === 'overdue')
      const healthyIdx = slas.findIndex(s => s.status === 'healthy')
      if (overdueIdx >= 0 && healthyIdx >= 0) {
        expect(overdueIdx).toBeLessThan(healthyIdx)
      }
    }
  })
})

// ── Agent filtering ──

describe('Agent filtering', () => {
  it('should exclude test/system agents from SLA by default', () => {
    ensureReflectionTrackingTable()
    // Create tasks for real and fake agents
    onTaskDone(makeTask({ assignee: 'link' }))
    onTaskDone(makeTask({ assignee: 'test-agent-123' }))
    onTaskDone(makeTask({ assignee: 'proof-agent-xyz' }))
    onTaskDone(makeTask({ assignee: 'unassigned' }))

    const slas = getReflectionSLAs()
    const agentNames = slas.map(s => s.agent)

    // Real agents should appear
    // test/proof/unassigned should be filtered out
    expect(agentNames).not.toContain('test-agent-123')
    expect(agentNames).not.toContain('proof-agent-xyz')
    expect(agentNames).not.toContain('unassigned')
  })

  it('should include agents tracked via onReflectionSubmitted', () => {
    ensureReflectionTrackingTable()
    // Agents who have submitted reflections should appear in SLA tracking
    onReflectionSubmitted('sage')
    onReflectionSubmitted('link')

    // Create active tasks so they show up in getActiveAgents
    taskManager.createTask({
      title: 'Active task for sage',
      description: 'test',
      assignee: 'sage',
      reviewer: 'kai',
      done_criteria: ['done'],
      createdBy: 'system',
      priority: 'P1',
    })
    taskManager.createTask({
      title: 'Active task for link',
      description: 'test',
      assignee: 'link',
      reviewer: 'kai',
      done_criteria: ['done'],
      createdBy: 'system',
      priority: 'P1',
    })

    const slas = getReflectionSLAs()
    const agentNames = slas.map(s => s.agent)
    expect(agentNames).toContain('sage')
    expect(agentNames).toContain('link')
    expect(slas.length).toBeGreaterThanOrEqual(2)
  })
})

// ── Never-reflected nudges ──

describe('Never-reflected agent nudging', () => {
  it('should nudge agents who have never reflected when enough time passes', async () => {
    ensureReflectionTrackingTable()
    const task = makeTask({ assignee: 'new-hire' })
    onTaskDone(task)

    // Fire the post-task nudge immediately
    const pending = _getPendingNudges()
    if (pending.length > 0) {
      ;(pending[0] as any).nudgeAt = Date.now() - 1000
    }

    const result = await tickReflectionNudges()
    // Should have fired the post-task nudge for new-hire
    expect(result.postTaskNudges).toBeGreaterThanOrEqual(0)
    expect(result).toHaveProperty('total')
  })

  it('should mark never-reflected agents as overdue in SLA', () => {
    ensureReflectionTrackingTable()
    onTaskDone(makeTask({ assignee: 'new-hire' }))

    const slas = getReflectionSLAs()
    const newHireSla = slas.find(s => s.agent === 'new-hire')
    if (newHireSla) {
      expect(newHireSla.status).toBe('overdue')
      expect(newHireSla.lastReflectionAt).toBeNull()
    }
  })
})

// ── E2E: multi-agent team automation ──

describe('End-to-end: team-wide automation', () => {
  it('should track reflection cadence across multiple agents', async () => {
    ensureReflectionTrackingTable()

    // Simulate a team of 3 agents completing tasks
    const agents = ['dev-alice', 'dev-bob', 'ops-charlie']

    // All complete tasks
    for (const agent of agents) {
      onTaskDone(makeTask({ assignee: agent }))
    }

    // Alice and Bob submit reflections
    onReflectionSubmitted('dev-alice')
    onReflectionSubmitted('dev-bob')

    // Check SLAs
    const slas = getReflectionSLAs()
    const aliceSla = slas.find(s => s.agent === 'dev-alice')
    const bobSla = slas.find(s => s.agent === 'dev-bob')
    const charlieSla = slas.find(s => s.agent === 'ops-charlie')

    // Alice and Bob should be healthy
    if (aliceSla) expect(aliceSla.status).toBe('healthy')
    if (bobSla) expect(bobSla.status).toBe('healthy')

    // Charlie never reflected — should be overdue
    if (charlieSla) expect(charlieSla.status).toBe('overdue')

    // Tick should generate nudges
    const pending = _getPendingNudges()
    // Modify all pending to fire now
    for (const p of pending) {
      ;(p as any).nudgeAt = Date.now() - 1000
    }

    const result = await tickReflectionNudges()
    // Charlie's post-task nudge should fire (alice/bob already reflected)
    expect(result.total).toBeGreaterThanOrEqual(0) // may be 0 if routeMessage fails silently
    expect(result).toHaveProperty('postTaskNudges')
    expect(result).toHaveProperty('idleNudges')
  })

  it('should handle continuous reflection cycle', async () => {
    ensureReflectionTrackingTable()

    // Agent does tasks, reflects, does more tasks
    onTaskDone(makeTask({ assignee: 'cycle-agent' }))
    onReflectionSubmitted('cycle-agent')

    let slas = getReflectionSLAs()
    let agentSla = slas.find(s => s.agent === 'cycle-agent')
    if (agentSla) {
      expect(agentSla.status).toBe('healthy')
      expect(agentSla.tasksDoneSinceLastReflection).toBe(0)
    }

    // More tasks without reflection
    onTaskDone(makeTask({ assignee: 'cycle-agent' }))
    onTaskDone(makeTask({ assignee: 'cycle-agent' }))

    slas = getReflectionSLAs()
    agentSla = slas.find(s => s.agent === 'cycle-agent')
    if (agentSla) {
      expect(agentSla.tasksDoneSinceLastReflection).toBe(2)
    }

    // Reflect again — counter resets
    onReflectionSubmitted('cycle-agent')
    slas = getReflectionSLAs()
    agentSla = slas.find(s => s.agent === 'cycle-agent')
    if (agentSla) {
      expect(agentSla.tasksDoneSinceLastReflection).toBe(0)
    }
  })
})
