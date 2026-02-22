// Tests for insight-task-bridge catch-up scan
// Verifies that promoted insights without tasks are processed on bridge startup
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'
import { createReflection } from '../src/reflections.js'
import { ingestReflection, getInsight, updateInsightStatus } from '../src/insights.js'
import {
  stopInsightTaskBridge,
  startInsightTaskBridge,
  getInsightTaskBridgeStats,
  _resetBridgeStats,
} from '../src/insight-task-bridge.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
  // Wait for initial catch-up to finish
  await new Promise(r => setTimeout(r, 200))
})

afterAll(async () => {
  await app.close()
})

function createTestReflection(overrides: Record<string, unknown> = {}) {
  return createReflection({
    pain: overrides.pain as string || 'Catch-up test pain',
    impact: overrides.impact as string || 'Test impact',
    evidence: overrides.evidence as string[] || ['evidence-catchup-1'],
    went_well: overrides.went_well as string || 'went well',
    suspected_why: overrides.suspected_why as string || 'test suspected why',
    proposed_fix: overrides.proposed_fix as string || 'test fix',
    confidence: overrides.confidence as number ?? 7,
    role_type: overrides.role_type as any || 'agent',
    author: overrides.author as string || `catchup-${Math.random().toString(36).slice(2, 6)}`,
    severity: overrides.severity as any || 'high',
    tags: overrides.tags as string[] || [`stage:test`, `family:catchup-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, `unit:test`],
  })
}

describe('Bridge catch-up scan', () => {
  it('processes promoted insights without tasks on bridge restart', async () => {
    // Stop bridge first so events aren't caught live
    stopInsightTaskBridge()
    _resetBridgeStats()

    const uniqueFamily = `catchup-restart-${Date.now()}`
    const tags = [`stage:test`, `family:${uniqueFamily}`, `unit:test`]

    // Create a high-severity reflection → insight gets created
    const ref = createTestReflection({ severity: 'high', tags })
    const insight = ingestReflection(ref)

    // Manually force to promoted with no task_id (simulating missed event)
    updateInsightStatus(insight.id, 'promoted')

    const before = getInsight(insight.id)
    expect(before?.status).toBe('promoted')
    expect(before?.task_id).toBeFalsy()

    // Restart the bridge — catch-up should fire
    startInsightTaskBridge()
    await new Promise(r => setTimeout(r, 200))

    // Check that the insight now has a task
    const after = getInsight(insight.id)
    expect(after?.task_id).toBeTruthy()
    expect(after?.status).toBe('task_created')
  })

  it('routes medium-severity promoted insights to pending_triage on catch-up', async () => {
    stopInsightTaskBridge()
    _resetBridgeStats()

    const uniqueFamily = `catchup-triage-${Date.now()}`
    const tags = [`stage:test`, `family:${uniqueFamily}`, `unit:test`]

    const ref = createTestReflection({ severity: 'medium', tags })
    const insight = ingestReflection(ref)

    // Force to promoted (simulating gate override or missed event)
    updateInsightStatus(insight.id, 'promoted')

    const before = getInsight(insight.id)
    expect(before?.status).toBe('promoted')
    expect(before?.task_id).toBeFalsy()

    startInsightTaskBridge()
    await new Promise(r => setTimeout(r, 200))

    const after = getInsight(insight.id)
    expect(after?.status).toBe('pending_triage')
    expect(after?.task_id).toBeFalsy()
  })

  it('skips insights that already have tasks (idempotent)', async () => {
    stopInsightTaskBridge()
    _resetBridgeStats()

    const uniqueFamily = `catchup-idempotent-${Date.now()}`
    const tags = [`stage:test`, `family:${uniqueFamily}`, `unit:test`]

    const ref = createTestReflection({ severity: 'high', tags })
    const insight = ingestReflection(ref)

    // Set to task_created with an existing task (normal completed flow)
    updateInsightStatus(insight.id, 'task_created', 'task-existing-123')

    startInsightTaskBridge()
    await new Promise(r => setTimeout(r, 200))

    // task_id should remain the original (not overwritten)
    const after = getInsight(insight.id)
    expect(after?.task_id).toBe('task-existing-123')
  })
})
