/**
 * E2E validation: reflection → insight → promotion → task/triage
 *
 * Proves the full reflection loop closure:
 * 1. High/critical: reflection → insight → promoted → auto-task (with linkage)
 * 2. Medium/low: reflection → insight → promoted → triage → approve → task
 * 3. Assignment policy: non-author assignee preferred
 * 4. Regression guard: listener stays registered after multiple ticks
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'
import { setTestRoles } from '../src/assignment.js'
import { TEST_AGENT_ROLES } from './fixtures/test-roles.js'
import { getDb } from '../src/db.js'
import { createReflection } from '../src/reflections.js'
import { ingestReflection, getInsight } from '../src/insights.js'
import {
  _handlePromotedInsight,
  getInsightTaskBridgeStats,
  _resetBridgeStats,
} from '../src/insight-task-bridge.js'
import { eventBus } from '../src/events.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  setTestRoles(TEST_AGENT_ROLES)
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

function makeReflection(overrides: Record<string, unknown> = {}) {
  return createReflection({
    pain: overrides.pain as string || 'System crashed under load',
    impact: overrides.impact as string || 'Users affected for 30 minutes',
    evidence: overrides.evidence as string[] || ['https://logs.example.com/crash-123'],
    went_well: overrides.went_well as string || 'Monitoring caught it quickly',
    suspected_why: overrides.suspected_why as string || 'Memory leak in connection pool',
    proposed_fix: overrides.proposed_fix as string || 'Add connection pool limits',
    confidence: overrides.confidence as number ?? 8,
    role_type: overrides.role_type as any || 'engineering',
    author: overrides.author as string || 'link',
    severity: overrides.severity as string || 'high',
    tags: overrides.tags as string[] || ['stage:deploy', 'family:runtime-error', 'unit:api'],
  })
}

describe('E2E: Reflection loop closure', () => {
  beforeEach(() => {
    _resetBridgeStats()
  })

  it('HIGH path: reflection → insight → promoted → auto-task with full linkage', async () => {
    // Step 1: Create reflection
    const reflection = makeReflection({
      severity: 'high',
      author: 'pixel',
      tags: ['stage:e2e-high', 'family:e2e-crash', 'unit:e2e-api'],
    })
    expect(reflection.id).toBeTruthy()

    // Step 2: Ingest to insight
    const insight = ingestReflection(reflection)
    expect(insight).toBeDefined()
    // Status may be 'candidate' or 'promoted' depending on auto-promotion gates
    expect(['candidate', 'promoted']).toContain(insight.status)
    expect(insight.severity_max).toBe('high')

    // Step 3: Simulate promotion event (normally triggered by canPromote() gate)
    await _handlePromotedInsight({
      id: `evt-e2e-high-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id, priority: 'P1', score: 7 },
    })

    // Step 4: Verify task was auto-created (or dedup-linked if EventBus listener fired first)
    const stats = getInsightTaskBridgeStats()
    expect(stats.tasksAutoCreated + stats.duplicatesSkipped).toBeGreaterThanOrEqual(1)

    // Step 5: Verify full linkage
    const updatedInsight = getInsight(insight.id)
    expect(updatedInsight?.status).toBe('task_created')
    expect(updatedInsight?.task_id).toBeTruthy()

    // Step 6: Verify task has metadata.insight_id
    if (updatedInsight?.task_id) {
      const taskRes = await app.inject({
        method: 'GET',
        url: `/tasks/${updatedInsight.task_id}`,
      })
      const task = JSON.parse(taskRes.body).task
      expect(task.metadata.insight_id).toBe(insight.id)
      expect(task.metadata.source).toBe('insight-task-bridge')
      expect(task.metadata.severity).toBe('high')

      // Step 7: Verify non-author assignment
      // Author was 'pixel', assignee should be different
      expect(task.assignee).not.toBe('pixel')
    }
  })

  it('CRITICAL path: same flow with P0 priority', async () => {
    const reflection = makeReflection({
      severity: 'critical',
      author: 'echo',
      tags: ['stage:e2e-crit', 'family:e2e-outage', 'unit:e2e-infra'],
    })
    const insight = ingestReflection(reflection)
    expect(insight).toBeDefined()

    await _handlePromotedInsight({
      id: `evt-e2e-crit-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id, priority: 'P0', score: 9 },
    })

    const critStats = getInsightTaskBridgeStats()
    expect(critStats.tasksAutoCreated + critStats.duplicatesSkipped).toBeGreaterThanOrEqual(1)

    const updated = getInsight(insight.id)
    expect(updated?.status).toBe('task_created')
    expect(updated?.task_id).toBeTruthy()
  })

  it('MEDIUM path: reflection → insight → triage → approve → task', async () => {
    // Step 1-2: Create + ingest
    const reflection = makeReflection({
      severity: 'medium',
      author: 'scout',
      tags: ['stage:e2e-med', 'family:e2e-ux', 'unit:e2e-dash'],
    })
    const insight = ingestReflection(reflection)
    expect(insight).toBeDefined()

    // Step 3: Promotion routes to triage
    await _handlePromotedInsight({
      id: `evt-e2e-med-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id, priority: 'P2', score: 4 },
    })

    expect(getInsightTaskBridgeStats().insightsTriaged).toBe(1)

    // Step 4: Verify triage queue has the insight
    const triageRes = await app.inject({ method: 'GET', url: '/insights/triage' })
    const triageBody = JSON.parse(triageRes.body)
    const inTriage = triageBody.triage_queue.find((i: any) => i.id === insight.id)
    expect(inTriage).toBeDefined()
    expect(inTriage?.status).toBe('pending_triage')

    // Step 5: Approve from triage → creates task
    const approveRes = await app.inject({
      method: 'POST',
      url: `/insights/${insight.id}/triage`,
      payload: {
        action: 'approve',
        assignee: 'link',
        reviewer: 'sage',
        reason: 'E2E test: validated UX issue needs fix',
      },
    })
    expect(approveRes.statusCode).toBe(200)
    const approveBody = JSON.parse(approveRes.body)
    expect(approveBody.success).toBe(true)

    // Step 6: Verify insight now links to task
    const finalInsight = getInsight(insight.id)
    expect(finalInsight?.status).toBe('task_created')
    expect(finalInsight?.task_id).toBeTruthy()
  })

  it('LOW path: routes to triage (no auto-task)', async () => {
    const reflection = makeReflection({
      severity: 'low',
      tags: ['stage:e2e-low', 'family:e2e-minor', 'unit:e2e-settings'],
    })
    const insight = ingestReflection(reflection)
    expect(insight).toBeDefined()

    await _handlePromotedInsight({
      id: `evt-e2e-low-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id, priority: 'P3', score: 2 },
    })

    expect(getInsightTaskBridgeStats().tasksAutoCreated).toBe(0)
    expect(getInsightTaskBridgeStats().insightsTriaged).toBe(1)
    expect(getInsight(insight.id)?.status).toBe('pending_triage')
  })

  it('REGRESSION: listener stays registered after multiple events', async () => {
    // Fire 3 events in sequence — listener should handle all
    for (let i = 0; i < 3; i++) {
      const r = makeReflection({
        severity: 'high',
        tags: [`stage:reg-${i}`, `family:reg-${i}`, `unit:reg-${i}`],
      })
      const insight = ingestReflection(r)
      await _handlePromotedInsight({
        id: `evt-reg-${Date.now()}-${i}`,
        type: 'task_created',
        timestamp: Date.now(),
        data: { kind: 'insight:promoted', insightId: insight.id },
      })
    }

    // All 3 should have been processed (auto-created or dedup-linked by EventBus listener)
    const stats = getInsightTaskBridgeStats()
    expect(stats.tasksAutoCreated + stats.duplicatesSkipped).toBeGreaterThanOrEqual(3)
    expect(stats.errors).toBe(0)
  })

  it('ASSIGNMENT: non-author soft guardrail', async () => {
    // Author is 'link' — assignee should be someone else
    const r = makeReflection({
      severity: 'critical',
      author: 'link',
      tags: ['stage:assign-1', 'family:assign-1', 'unit:assign-1'],
    })
    const insight = ingestReflection(r)

    await _handlePromotedInsight({
      id: `evt-assign-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id },
    })

    const updated = getInsight(insight.id)
    if (updated?.task_id) {
      const taskRes = await app.inject({ method: 'GET', url: `/tasks/${updated.task_id}` })
      const task = JSON.parse(taskRes.body).task
      // Assignee should not be 'link' (the author)
      expect(task.assignee).not.toBe('link')
    }
  })
})
