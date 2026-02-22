/**
 * Tests for insight:promoted → auto-task bridge (severity-aware).
 *
 * Verifies:
 * - Listener registers and tracks stats
 * - High/critical insights auto-create tasks
 * - Medium/low insights route to triage (pending_triage)
 * - Triage endpoints work (list, approve, dismiss)
 * - New insight statuses: pending_triage, task_created
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'
import {
  getInsightTaskBridgeStats,
  _resetBridgeStats,
  _handlePromotedInsight,
} from '../src/insight-task-bridge.js'
import { createReflection } from '../src/reflections.js'
import { ingestReflection, getInsight, updateInsightStatus, INSIGHT_STATUSES } from '../src/insights.js'
import { eventBus } from '../src/events.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

function createTestInsight(overrides: Record<string, unknown> = {}) {
  const reflection = createReflection({
    pain: overrides.pain as string || 'Test failure in CI pipeline',
    impact: overrides.impact as string || 'Blocks deployments',
    evidence: overrides.evidence as string[] || ['https://example.com/evidence'],
    went_well: overrides.went_well as string || 'Detection was quick',
    suspected_why: overrides.suspected_why as string || 'Flaky test dependency',
    proposed_fix: overrides.proposed_fix as string || 'Pin dependency versions',
    confidence: overrides.confidence as number ?? 7,
    role_type: overrides.role_type as any || 'agent',
    author: overrides.author as string || 'link',
    severity: overrides.severity as string || 'high',
    tags: overrides.tags as string[] || ['stage:build', 'family:test-failure', 'unit:api'],
  })
  const insight = ingestReflection(reflection)
  return { reflection, insight }
}

describe('Insight statuses', () => {
  it('includes pending_triage and task_created', () => {
    expect(INSIGHT_STATUSES).toContain('pending_triage')
    expect(INSIGHT_STATUSES).toContain('task_created')
  })
})

describe('updateInsightStatus', () => {
  it('updates status', () => {
    const { insight } = createTestInsight({ tags: ['stage:s1', 'family:f1', 'unit:u1'] })
    const ok = updateInsightStatus(insight.id, 'pending_triage')
    expect(ok).toBe(true)
    expect(getInsight(insight.id)?.status).toBe('pending_triage')
  })

  it('updates status and task_id', () => {
    const { insight } = createTestInsight({ tags: ['stage:s2', 'family:f2', 'unit:u2'] })
    updateInsightStatus(insight.id, 'task_created', 'task-fake-123')
    const refreshed = getInsight(insight.id)
    expect(refreshed?.status).toBe('task_created')
    expect(refreshed?.task_id).toBe('task-fake-123')
  })
})

describe('Insight→Task bridge', () => {
  beforeEach(() => {
    _resetBridgeStats()
  })

  it('bridge stats endpoint works', async () => {
    const res = await app.inject({ method: 'GET', url: '/insights/bridge/stats' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('tasksAutoCreated')
    expect(body).toHaveProperty('insightsTriaged')
  })

  it('high severity auto-creates task', async () => {
    const statsBefore = getInsightTaskBridgeStats()
    const { insight } = createTestInsight({ severity: 'high', tags: ['stage:h1', 'family:h1', 'unit:h1'] })

    await _handlePromotedInsight({
      id: `evt-test-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id },
    })

    const statsAfter = getInsightTaskBridgeStats()
    expect(statsAfter.tasksAutoCreated).toBeGreaterThan(statsBefore.tasksAutoCreated)

    const updated = getInsight(insight.id)
    expect(updated?.status).toBe('task_created')
    expect(updated?.task_id).toBeTruthy()
  })

  it('medium severity routes to triage', async () => {
    const { insight } = createTestInsight({ severity: 'medium', tags: ['stage:m1', 'family:m1', 'unit:m1'] })

    await _handlePromotedInsight({
      id: `evt-test-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id },
    })

    const stats = getInsightTaskBridgeStats()
    expect(stats.insightsTriaged).toBe(1)

    const updated = getInsight(insight.id)
    expect(updated?.status).toBe('pending_triage')
  })

  it('skips duplicate (insight already has task_id)', async () => {
    const { insight } = createTestInsight({ severity: 'high', tags: ['stage:d1', 'family:d1', 'unit:d1'] })
    updateInsightStatus(insight.id, 'task_created', 'task-existing')

    await _handlePromotedInsight({
      id: `evt-test-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id },
    })

    const stats = getInsightTaskBridgeStats()
    expect(stats.duplicatesSkipped).toBe(1)
    expect(stats.tasksAutoCreated).toBe(0)
  })
})

describe('EventBus internal listeners', () => {
  it('on/off registration is available', () => {
    // Verify the EventBus supports internal listener API
    expect(typeof eventBus.on).toBe('function')
    expect(typeof eventBus.off).toBe('function')
    expect(typeof eventBus.emit).toBe('function')
  })
})

describe('Triage endpoints', () => {
  it('GET /insights/triage returns queue', async () => {
    const { insight } = createTestInsight({ tags: ['stage:tq1', 'family:tq1', 'unit:tq1'] })
    updateInsightStatus(insight.id, 'pending_triage')

    const res = await app.inject({ method: 'GET', url: '/insights/triage' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.triage_queue.some((i: any) => i.id === insight.id)).toBe(true)
  })

  it('POST dismiss closes insight', async () => {
    const { insight } = createTestInsight({ tags: ['stage:td1', 'family:td1', 'unit:td1'] })
    updateInsightStatus(insight.id, 'pending_triage')

    const res = await app.inject({
      method: 'POST',
      url: `/insights/${insight.id}/triage`,
      payload: { action: 'dismiss' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).action).toBe('dismissed')
    expect(getInsight(insight.id)?.status).toBe('closed')
  })

  it('POST approve creates task + links', async () => {
    const { insight } = createTestInsight({ tags: ['stage:ta1', 'family:ta1', 'unit:ta1'] })
    updateInsightStatus(insight.id, 'pending_triage')

    const res = await app.inject({
      method: 'POST',
      url: `/insights/${insight.id}/triage`,
      payload: { action: 'approve', assignee: 'link', reviewer: 'sage', priority: 'P2' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.task_id).toBeDefined()

    const refreshed = getInsight(insight.id)
    expect(refreshed?.status).toBe('task_created')
    expect(refreshed?.task_id).toBe(body.task_id)
  })

  it('rejects triage on wrong status', async () => {
    const { insight } = createTestInsight({ tags: ['stage:tw1', 'family:tw1', 'unit:tw1'] })
    const res = await app.inject({
      method: 'POST',
      url: `/insights/${insight.id}/triage`,
      payload: { action: 'approve', assignee: 'link' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects approve without assignee', async () => {
    const { insight } = createTestInsight({ tags: ['stage:tn1', 'family:tn1', 'unit:tn1'] })
    updateInsightStatus(insight.id, 'pending_triage')
    const res = await app.inject({
      method: 'POST',
      url: `/insights/${insight.id}/triage`,
      payload: { action: 'approve' },
    })
    expect(res.statusCode).toBe(400)
  })
})
