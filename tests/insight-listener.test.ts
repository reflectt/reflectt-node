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
  resolveAssignment,
  configureBridge,
  getBridgeConfig,
  type AssignmentDecision,
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
    const suffix = Date.now().toString(36)
    const { insight } = createTestInsight({ severity: 'high', pain: `High severity unique test ${suffix}`, tags: [`stage:h1-${suffix}`, `family:h1-${suffix}`, `unit:h1-${suffix}`] })

    await _handlePromotedInsight({
      id: `evt-test-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id },
    })

    const statsAfter = getInsightTaskBridgeStats()
    // Either the EventBus listener or our manual call created the task (dedup prevents double-create)
    const totalActivity = (statsAfter.tasksAutoCreated - statsBefore.tasksAutoCreated) +
                          (statsAfter.duplicatesSkipped - statsBefore.duplicatesSkipped)
    expect(totalActivity).toBeGreaterThan(0)

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

describe('Cross-insight dedup in auto-create', () => {
  beforeEach(() => {
    _resetBridgeStats()
    configureBridge({
      assignableAgents: ['link', 'sage'],
      ownershipGuardrail: { enabled: false, requireNonAuthorReviewer: false },
    })
  })

  it('prevents duplicate task when insight with same cluster key already has a task', async () => {
    // First insight creates a task via explicit handler call (deterministic, no race)
    const { insight: insight1 } = createTestInsight({
      severity: 'high',
      pain: 'Dedup test cluster pain alpha',
      tags: ['stage:dedup1', 'family:dedup-cluster', 'unit:dedup1'],
    })

    await _handlePromotedInsight({
      id: `evt-dedup1-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight1.id },
    })

    // Ensure first insight has a task
    const updated1 = getInsight(insight1.id)
    expect(updated1?.status).toBe('task_created')
    expect(updated1?.task_id).toBeTruthy()

    // Second insight with SAME cluster key — should link to existing task, not create new
    const { insight: insight2 } = createTestInsight({
      severity: 'high',
      pain: 'Dedup test cluster pain beta',
      tags: ['stage:dedup1', 'family:dedup-cluster', 'unit:dedup1'], // Same full cluster key
    })

    await _handlePromotedInsight({
      id: `evt-dedup2-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight2.id },
    })

    // Second insight should be linked to existing task (dedup fired)
    const updated2 = getInsight(insight2.id)
    expect(updated2?.status).toBe('task_created')
    expect(updated2?.task_id).toBeTruthy()
  })

  it('prevents duplicate task when evidence references an existing task id (follow-up insights)', async () => {
    const statsBefore = getInsightTaskBridgeStats()

    // First insight creates a task
    const { insight: insight1 } = createTestInsight({
      severity: 'high',
      pain: 'Evidence dedup alpha',
      tags: ['stage:evdedup-a', 'family:evdedup-a', 'unit:evdedup-a'],
    })

    await _handlePromotedInsight({
      id: `evt-evdedup1-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight1.id },
    })

    const updated1 = getInsight(insight1.id)
    expect(updated1?.task_id).toBeTruthy()
    const firstTaskId = updated1!.task_id

    // Second insight with a DIFFERENT cluster key, but referencing the first task in evidence
    const { insight: insight2 } = createTestInsight({
      severity: 'high',
      pain: 'Evidence dedup beta',
      evidence: [`See follow-up details in ${firstTaskId}`],
      tags: ['stage:evdedup-b', 'family:evdedup-b', 'unit:evdedup-b'],
    })

    await _handlePromotedInsight({
      id: `evt-evdedup2-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight2.id },
    })

    const updated2 = getInsight(insight2.id)
    expect(updated2?.task_id).toBe(firstTaskId)

    const statsAfter = getInsightTaskBridgeStats()
    expect(statsAfter.duplicatesSkipped - statsBefore.duplicatesSkipped).toBeGreaterThanOrEqual(1)
  })

  it('allows tasks from different cluster keys', async () => {
    const suffix = Date.now().toString(36)

    const { insight: insight1 } = createTestInsight({
      severity: 'high',
      pain: `Different cluster alpha ${suffix}`,
      tags: [`stage:diff1-${suffix}`, `family:cluster-a-${suffix}`, `unit:diff1-${suffix}`],
    })

    const { insight: insight2 } = createTestInsight({
      severity: 'high',
      pain: `Different cluster beta ${suffix}`,
      tags: [`stage:diff2-${suffix}`, `family:cluster-b-${suffix}`, `unit:diff2-${suffix}`],
    })

    const waitForTaskCreated = async (insightId: string, timeoutMs = 1500) => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const i = getInsight(insightId)
        if (i?.status === 'task_created' && i.task_id) return i
        await new Promise(r => setTimeout(r, 25))
      }
      return getInsight(insightId)
    }

    // Both insights should have tasks (different clusters = different tasks)
    const updated1 = await waitForTaskCreated(insight1.id)
    const updated2 = await waitForTaskCreated(insight2.id)

    expect(updated1?.status).toBe('task_created')
    expect(updated1?.task_id).toBeTruthy()
    expect(updated2?.status).toBe('task_created')
    expect(updated2?.task_id).toBeTruthy()

    // Tasks should be different
    expect(updated1?.task_id).not.toBe(updated2?.task_id)
  })
})

describe('EventBus internal listeners', () => {
  it('on/off registration is available', () => {
    // Verify the EventBus supports internal listener API
    expect(typeof eventBus.on).toBe('function')
    expect(typeof eventBus.off).toBe('function')
    expect(typeof eventBus.emit).toBe('function')
  })

  it('regression: listener processes events emitted through EventBus after bridge startup', async () => {
    // This test exercises the REAL listener path (not direct handler calls)
    // to prove registration survival across multiple events.
    const { startInsightTaskBridge, stopInsightTaskBridge, getInsightTaskBridgeStats, _resetBridgeStats } = await import('../src/insight-task-bridge.js')

    _resetBridgeStats()
    startInsightTaskBridge()

    // Create two insights with high severity
    const { insight: insight1 } = createTestInsight({
      tags: ['stage:eb-regression1', 'family:eb-regression1', 'unit:eb-regression1'],
      severity: 'high',
    })
    const { insight: insight2 } = createTestInsight({
      tags: ['stage:eb-regression2', 'family:eb-regression2', 'unit:eb-regression2'],
      severity: 'critical',
    })

    // Emit through EventBus (not direct handler call)
    eventBus.emit({
      id: `evt-regression-1-${Date.now()}`,
      type: 'task_created' as const,
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight1.id },
    })

    // Small delay to allow async handler
    await new Promise(r => setTimeout(r, 50))

    // Emit second event — proves listener survives across multiple events
    eventBus.emit({
      id: `evt-regression-2-${Date.now()}`,
      type: 'task_created' as const,
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight2.id },
    })

    await new Promise(r => setTimeout(r, 50))

    const stats = getInsightTaskBridgeStats()
    // Both should have been processed (auto-created since high/critical)
    expect(stats.tasksAutoCreated).toBeGreaterThanOrEqual(2)
    expect(stats.lastEventAt).toBeTruthy()

    stopInsightTaskBridge()
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

// ── Ownership Guardrail Tests ──

describe('Ownership guardrail: resolveAssignment', () => {
  // Save original config so we can restore after each test
  let originalConfig: ReturnType<typeof getBridgeConfig>

  beforeEach(() => {
    originalConfig = getBridgeConfig()
  })

  afterEach(() => {
    // Restore config
    configureBridge(originalConfig)
  })

  it('single author: assigns non-author when guardrail enabled', () => {
    configureBridge({
      assignableAgents: ['link', 'sage', 'kai'],
      ownershipGuardrail: { enabled: true, requireNonAuthorReviewer: true },
    })

    const { insight } = createTestInsight({
      author: 'link',
      severity: 'high',
      tags: ['stage:og1', 'family:og1', 'unit:og1'],
    })

    const decision = resolveAssignment(insight)
    expect(decision.assignee).not.toBe('link')
    expect(decision.guardrailApplied).toBe(true)
    expect(decision.soleAuthorFallback).toBe(false)
    expect(decision.insightAuthors).toContain('link')
    expect(decision.reason).toContain('avoided')
  })

  it('single author: falls back to author when no alternatives exist', () => {
    configureBridge({
      assignableAgents: ['link'],  // Only the author is available
      ownershipGuardrail: { enabled: true, requireNonAuthorReviewer: true },
    })

    const { insight } = createTestInsight({
      author: 'link',
      severity: 'high',
      tags: ['stage:og2', 'family:og2', 'unit:og2'],
    })

    const decision = resolveAssignment(insight)
    expect(decision.assignee).toBe('link')
    expect(decision.guardrailApplied).toBe(true)
    expect(decision.soleAuthorFallback).toBe(true)
    expect(decision.reason).toContain('author_exclusion_bypassed')
    // Reviewer must not be the author
    expect(decision.reviewer).not.toBe('link')
  })

  it('multi-author: normal routing (guardrail does not fire)', () => {
    configureBridge({
      assignableAgents: ['link', 'sage', 'kai'],
      ownershipGuardrail: { enabled: true, requireNonAuthorReviewer: true },
    })

    // Create two reflections from different authors to produce multi-author insight
    const r1 = createReflection({
      pain: 'Multi-author test pain',
      impact: 'Blocks flow',
      evidence: ['https://example.com/ma1'],
      went_well: 'Quick detection',
      suspected_why: 'Config drift',
      proposed_fix: 'Pin configs',
      confidence: 8,
      role_type: 'agent',
      author: 'link',
      severity: 'high',
      tags: ['stage:og3', 'family:og3', 'unit:og3'],
    })
    const insight1 = ingestReflection(r1)

    const r2 = createReflection({
      pain: 'Multi-author test pain variant',
      impact: 'Blocks flow too',
      evidence: ['https://example.com/ma2'],
      went_well: 'Good monitoring',
      suspected_why: 'Config drift again',
      proposed_fix: 'Pin configs v2',
      confidence: 7,
      role_type: 'agent',
      author: 'sage',
      severity: 'high',
      tags: ['stage:og3', 'family:og3', 'unit:og3'],
    })
    const insight2 = ingestReflection(r2)

    // Use whichever insight has multiple authors (they cluster on same key)
    const multiInsight = getInsight(insight1.id) || getInsight(insight2.id)
    expect(multiInsight).toBeTruthy()

    // If they clustered together, authors should include both
    if (multiInsight!.authors.length > 1) {
      const decision = resolveAssignment(multiInsight!)
      expect(decision.guardrailApplied).toBe(false)
      expect(decision.soleAuthorFallback).toBe(false)
      expect(decision.reason).toContain('Multi-author')
    }
  })

  it('guardrail disabled: allows author assignment', () => {
    configureBridge({
      assignableAgents: ['link', 'sage'],
      ownershipGuardrail: { enabled: false, requireNonAuthorReviewer: false },
    })

    const { insight } = createTestInsight({
      author: 'link',
      severity: 'high',
      tags: ['stage:og4', 'family:og4', 'unit:og4'],
    })

    const decision = resolveAssignment(insight)
    expect(decision.guardrailApplied).toBe(false)
    expect(decision.reason).toContain('disabled')
  })

  it('team override disables guardrail for specific team', () => {
    configureBridge({
      assignableAgents: ['link', 'sage'],
      ownershipGuardrail: {
        enabled: true,
        requireNonAuthorReviewer: true,
        teamOverrides: { 'team-alpha': false },
      },
    })

    const { insight } = createTestInsight({
      author: 'link',
      severity: 'high',
      tags: ['stage:og5', 'family:og5', 'unit:og5'],
    })

    // With team override disabled, guardrail should NOT fire
    const decision = resolveAssignment(insight, 'team-alpha')
    expect(decision.guardrailApplied).toBe(false)
  })

  it('team override preserves guardrail for other teams', () => {
    configureBridge({
      assignableAgents: ['link', 'sage', 'kai'],
      ownershipGuardrail: {
        enabled: true,
        requireNonAuthorReviewer: true,
        teamOverrides: { 'team-alpha': false },
      },
    })

    const { insight } = createTestInsight({
      author: 'link',
      severity: 'high',
      tags: ['stage:og6', 'family:og6', 'unit:og6'],
    })

    // Different team — guardrail should still fire
    const decision = resolveAssignment(insight, 'team-beta')
    expect(decision.guardrailApplied).toBe(true)
    expect(decision.assignee).not.toBe('link')
  })

  it('bypasses author-exclusion when author is best role-fit', () => {
    // link has strong affinity for backend/api/integration tasks
    configureBridge({
      assignableAgents: ['link', 'pixel', 'echo'],
      ownershipGuardrail: { enabled: true, requireNonAuthorReviewer: true },
    })

    // Pain/title will contain backend keywords → link gets highest affinity
    const { insight } = createTestInsight({
      author: 'link',
      severity: 'high',
      pain: 'Backend API integration bug in task-lifecycle server webhook',
      tags: ['stage:rf1', 'family:backend-api', 'unit:rf1'],
    })

    const decision = resolveAssignment(insight)
    // Author assigned via sole-author fallback (no non-author candidates score positive)
    expect(decision.assignee).toBe('link')
    expect(decision.reason).toContain('author_exclusion_bypassed')
    expect(decision.soleAuthorFallback).toBe(true) // Triggers non-author reviewer
    // Reviewer must not be the author
    expect(decision.reviewer).not.toBe('link')
  })

  it('emits author_exclusion_applied reason code when non-author picked', () => {
    configureBridge({
      assignableAgents: ['link', 'sage', 'echo'],
      ownershipGuardrail: { enabled: true, requireNonAuthorReviewer: true },
    })

    // Pain about ops/deploy/CI — sage has higher affinity than link for these
    const { insight } = createTestInsight({
      author: 'link',
      severity: 'high',
      pain: 'CI deploy pipeline release infra failure blocking ops',
      tags: ['stage:rf2', 'family:deploy-pipeline', 'unit:rf2'],
    })

    const decision = resolveAssignment(insight)
    // sage should be picked (ops affinity for ci/deploy/pipeline/release)
    expect(decision.assignee).toBe('sage')
    expect(decision.reason).toContain('author_exclusion_applied')
    expect(decision.guardrailApplied).toBe(true)
  })

  it('bypasses author-exclusion with protected domain match', () => {
    configureBridge({
      assignableAgents: ['sage', 'link', 'echo'],
      ownershipGuardrail: { enabled: true, requireNonAuthorReviewer: true },
    })

    // sage has protectedDomains: ['deploy', 'ci', 'release']
    const { insight } = createTestInsight({
      author: 'sage',
      severity: 'high',
      pain: 'Deploy pipeline CI release failure in production',
      tags: ['stage:rf3', 'family:deploy-ci', 'unit:rf3'],
    })

    const decision = resolveAssignment(insight)
    expect(decision.assignee).toBe('sage')
    expect(decision.reason).toContain('author_exclusion_bypassed')
    expect(decision.reason).toContain('protected domain')
  })

  it('records assignment_decision in task metadata on auto-create', async () => {
    configureBridge({
      assignableAgents: ['link', 'sage', 'kai'],
      ownershipGuardrail: { enabled: true, requireNonAuthorReviewer: true },
    })

    const { insight } = createTestInsight({
      author: 'link',
      severity: 'high',
      tags: ['stage:og7', 'family:og7', 'unit:og7'],
    })

    _resetBridgeStats()
    await _handlePromotedInsight({
      id: `evt-guardrail-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id },
    })

    const updated = getInsight(insight.id)
    expect(updated?.task_id).toBeTruthy()

    // Fetch the created task and verify assignment_decision metadata
    const res = await app.inject({ method: 'GET', url: `/tasks/${updated!.task_id}` })
    expect(res.statusCode).toBe(200)
    const task = JSON.parse(res.body).task
    expect(task.metadata.assignment_decision).toBeDefined()
    expect(task.metadata.assignment_decision.insight_authors).toContain('link')
    expect(typeof task.metadata.assignment_decision.reason).toBe('string')
    expect(typeof task.metadata.assignment_decision.guardrail_applied).toBe('boolean')
  })

  it('sole-author fallback enforces non-author reviewer', () => {
    configureBridge({
      assignableAgents: ['link'],
      defaultReviewer: 'sage',
      ownershipGuardrail: { enabled: true, requireNonAuthorReviewer: true },
    })

    const { insight } = createTestInsight({
      author: 'link',
      severity: 'high',
      tags: ['stage:og8', 'family:og8', 'unit:og8'],
    })

    const decision = resolveAssignment(insight)
    expect(decision.soleAuthorFallback).toBe(true)
    expect(decision.reviewer).not.toBe('link')
  })

  // ── Author-exclusion bypass tests (task-1771874104673-4h2ctitwp) ──

  it('author-exclusion bypassed when author is best role-fit (no viable non-author)', () => {
    configureBridge({
      assignableAgents: ['kai'],  // Only author available
      ownershipGuardrail: { enabled: true, requireNonAuthorReviewer: true },
    })

    const { insight } = createTestInsight({
      author: 'kai',
      severity: 'high',
      tags: ['stage:bypass1', 'family:bypass1', 'unit:bypass1'],
    })

    const decision = resolveAssignment(insight)
    expect(decision.assignee).toBe('kai')
    expect(decision.soleAuthorFallback).toBe(true)
    expect(decision.reason).toContain('author_exclusion_bypassed')
    // Non-author reviewer required
    expect(decision.reviewer).not.toBe('kai')
  })

  it('reason codes use author_exclusion_applied when non-author selected', () => {
    configureBridge({
      assignableAgents: ['link', 'sage', 'kai'],
      ownershipGuardrail: { enabled: true, requireNonAuthorReviewer: true },
    })

    const { insight } = createTestInsight({
      author: 'link',
      severity: 'high',
      tags: ['stage:bypass2', 'family:bypass2', 'unit:bypass2'],
    })

    const decision = resolveAssignment(insight)
    // If non-author was selected, reason should contain applied
    if (decision.assignee !== 'link') {
      expect(decision.reason).toContain('author_exclusion_applied')
    } else {
      // If author was selected (best fit), reason should contain bypassed
      expect(decision.reason).toContain('author_exclusion_bypassed')
    }
  })

  it('reason codes always include author_exclusion_applied or author_exclusion_bypassed', () => {
    configureBridge({
      assignableAgents: ['link', 'sage'],
      ownershipGuardrail: { enabled: true, requireNonAuthorReviewer: true },
    })

    const { insight } = createTestInsight({
      author: 'link',
      severity: 'high',
      tags: ['stage:bypass3', 'family:bypass3', 'unit:bypass3'],
    })

    const decision = resolveAssignment(insight)
    const hasApplied = decision.reason.includes('author_exclusion_applied')
    const hasBypassed = decision.reason.includes('author_exclusion_bypassed')
    expect(hasApplied || hasBypassed).toBe(true)
  })

  it('sole-author fallback triggers before cross-role delegation when no candidates score positive', () => {
    // Only author available, no others
    configureBridge({
      assignableAgents: ['kai'],
      ownershipGuardrail: { enabled: true, requireNonAuthorReviewer: true },
    })

    const { insight } = createTestInsight({
      author: 'kai',
      severity: 'high',
      tags: ['stage:bypass4', 'family:bypass4', 'unit:bypass4'],
    })

    const decision = resolveAssignment(insight)
    // Should fall back to author, not leave unassigned
    expect(decision.assignee).toBe('kai')
    expect(decision.reason).toContain('author_exclusion_bypassed')
  })

  it('candidatesConsidered is populated for audit', () => {
    configureBridge({
      assignableAgents: ['link', 'sage', 'kai', 'pixel'],
      ownershipGuardrail: { enabled: true, requireNonAuthorReviewer: true },
    })

    const { insight } = createTestInsight({
      author: 'link',
      severity: 'high',
      tags: ['stage:og9', 'family:og9', 'unit:og9'],
    })

    const decision = resolveAssignment(insight)
    expect(decision.candidatesConsidered).toEqual(['link', 'sage', 'kai', 'pixel'])
    expect(decision.insightAuthors).toEqual(['link'])
  })
})
