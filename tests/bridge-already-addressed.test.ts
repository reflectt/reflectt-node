/**
 * Tests for insight-task-bridge: already-addressed check + feature classification.
 *
 * Verifies:
 * - Already-fixed problems (done tasks) don't get new P0 tasks
 * - Validating tasks count as addressing the problem
 * - Feature-family insights route to triage, not auto-P0
 * - Bug-family insights still auto-create P0
 * - Stats track the new skip/route reasons
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'
import {
  getInsightTaskBridgeStats,
  _resetBridgeStats,
  _handlePromotedInsight,
  _findAlreadyAddressedTask,
  _isFeatureRequest,
  configureBridge,
  getBridgeConfig,
  FEATURE_FAMILIES,
} from '../src/insight-task-bridge.js'
import { createReflection } from '../src/reflections.js'
import { ingestReflection, getInsight, updateInsightStatus } from '../src/insights.js'
import { taskManager } from '../src/tasks.js'
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
    pain: overrides.pain as string || 'Test failure in pipeline',
    impact: overrides.impact as string || 'Blocks deployments',
    evidence: overrides.evidence as string[] || ['https://example.com/evidence'],
    went_well: overrides.went_well as string || 'Detection was quick',
    suspected_why: overrides.suspected_why as string || 'Flaky dependency',
    proposed_fix: overrides.proposed_fix as string || 'Pin versions',
    confidence: overrides.confidence as number ?? 7,
    role_type: overrides.role_type as any || 'agent',
    author: overrides.author as string || 'link',
    severity: overrides.severity as string || 'high',
    tags: overrides.tags as string[] || ['stage:build', 'family:test-failure', 'unit:api'],
  })
  const insight = ingestReflection(reflection)
  return { reflection, insight }
}

describe('Already-addressed task check', () => {
  let originalConfig: ReturnType<typeof getBridgeConfig>

  beforeEach(() => {
    originalConfig = getBridgeConfig()
    _resetBridgeStats()
    configureBridge({
      assignableAgents: ['link', 'sage'],
      ownershipGuardrail: { enabled: false, requireNonAuthorReviewer: false },
    })
  })

  afterEach(() => {
    configureBridge(originalConfig)
  })

  it('skips auto-create when done task covers same cluster_key', async () => {
    const suffix = Date.now().toString(36)
    const clusterKey = `aa1-${suffix}::addressed-${suffix}::aa1-${suffix}`

    // Create a task then move it to done (respecting lifecycle gates)
    const task = await taskManager.createTask({
      title: `[Insight] Previously fixed problem ${suffix}`,
      description: 'This was fixed already',
      status: 'todo',
      assignee: 'link',
      createdBy: 'insight-bridge',
      reviewer: 'sage',
      done_criteria: ['Root cause addressed'],
      metadata: {
        source: 'insight-task-bridge',
        cluster_key: clusterKey,
        insight_id: `ins-fake-${suffix}`,
        eta: '1d',
        artifact_path: 'process/TASK-fake.md',
      },
    })
    // Transition: todo → doing → validating → done
    await taskManager.updateTask(task.id, { status: 'doing' })
    await taskManager.updateTask(task.id, { status: 'validating' })
    await taskManager.updateTask(task.id, { status: 'done' })

    const doneTask = taskManager.listTasks({}).find(t => t.id === task.id)
    expect(doneTask?.status).toBe('done')

    // Now create a new insight with the same cluster_key
    const { insight } = createTestInsight({
      severity: 'high',
      pain: `Already addressed test ${suffix}`,
      tags: [`stage:aa1-${suffix}`, `family:addressed-${suffix}`, `unit:aa1-${suffix}`],
    })

    // Verify cluster_key matches
    expect(insight.cluster_key).toBe(clusterKey)

    // Wait for EventBus
    await new Promise(r => setTimeout(r, 50))

    const statsBefore = getInsightTaskBridgeStats()
    await _handlePromotedInsight({
      id: `evt-aa1-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id },
    })

    const statsAfter = getInsightTaskBridgeStats()
    // Should be caught by either already-addressed check or idempotency (EventBus may have already fired)
    const addressed = statsAfter.alreadyAddressedSkipped - statsBefore.alreadyAddressedSkipped
    const dupeSkipped = statsAfter.duplicatesSkipped - statsBefore.duplicatesSkipped
    expect(addressed + dupeSkipped).toBeGreaterThan(0)
    expect(statsAfter.tasksAutoCreated - statsBefore.tasksAutoCreated).toBe(0)
  })

  it('skips auto-create when validating task covers same cluster_key', async () => {
    const suffix = Date.now().toString(36)
    const clusterKey = `aa2-${suffix}::validating-${suffix}::aa2-${suffix}`

    // Create a task and move it to validating
    const task = await taskManager.createTask({
      title: `[Insight] Being validated ${suffix}`,
      description: 'This is being validated',
      status: 'todo',
      assignee: 'link',
      createdBy: 'insight-bridge',
      reviewer: 'sage',
      done_criteria: ['Root cause addressed'],
      metadata: {
        source: 'insight-task-bridge',
        cluster_key: clusterKey,
        insight_id: `ins-fake-val-${suffix}`,
        eta: '1d',
        artifact_path: 'process/TASK-fake-val.md',
      },
    })
    await taskManager.updateTask(task.id, { status: 'doing' })
    await taskManager.updateTask(task.id, { status: 'validating' })

    // Now create a new insight with the same cluster_key
    const { insight } = createTestInsight({
      severity: 'high',
      pain: `Validating test ${suffix}`,
      tags: [`stage:aa2-${suffix}`, `family:validating-${suffix}`, `unit:aa2-${suffix}`],
    })

    expect(insight.cluster_key).toBe(clusterKey)

    // Wait for EventBus
    await new Promise(r => setTimeout(r, 50))

    const statsBefore = getInsightTaskBridgeStats()
    await _handlePromotedInsight({
      id: `evt-aa2-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id },
    })

    const statsAfter = getInsightTaskBridgeStats()
    const addressed = statsAfter.alreadyAddressedSkipped - statsBefore.alreadyAddressedSkipped
    const dupeSkipped = statsAfter.duplicatesSkipped - statsBefore.duplicatesSkipped
    expect(addressed + dupeSkipped).toBeGreaterThan(0)
  })

  it('does NOT skip when done task is older than 30 days', async () => {
    const suffix = Date.now().toString(36)
    const clusterKey = `aa3-${suffix}::old-${suffix}::aa3-${suffix}`
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000

    // Create a task, move to done, then backdate
    const { getDb } = await import('../src/db.js')
    const task = await taskManager.createTask({
      title: `[Insight] Old fixed problem ${suffix}`,
      description: 'This was fixed long ago',
      status: 'todo',
      assignee: 'link',
      createdBy: 'insight-bridge',
      reviewer: 'sage',
      done_criteria: ['Root cause addressed'],
      metadata: {
        source: 'insight-task-bridge',
        cluster_key: clusterKey,
        insight_id: `ins-fake-old-${suffix}`,
        eta: '1d',
        artifact_path: 'process/TASK-fake-old.md',
      },
    })
    await taskManager.updateTask(task.id, { status: 'doing' })
    await taskManager.updateTask(task.id, { status: 'validating' })
    await taskManager.updateTask(task.id, { status: 'done' })

    // Backdate the updatedAt to 31 days ago
    const db = getDb()
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(thirtyOneDaysAgo, task.id)

    // New insight with same cluster — should NOT be caught (task too old)
    const { insight } = createTestInsight({
      severity: 'high',
      pain: `Old task test ${suffix}`,
      tags: [`stage:aa3-${suffix}`, `family:old-${suffix}`, `unit:aa3-${suffix}`],
    })

    expect(insight.cluster_key).toBe(clusterKey)

    // Wait for EventBus
    await new Promise(r => setTimeout(r, 50))

    const statsBefore = getInsightTaskBridgeStats()
    await _handlePromotedInsight({
      id: `evt-aa3-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id },
    })

    const statsAfter = getInsightTaskBridgeStats()
    // Old task shouldn't count as already-addressed
    expect(statsAfter.alreadyAddressedSkipped - statsBefore.alreadyAddressedSkipped).toBe(0)
    // Should either auto-create or be deduped from EventBus (but NOT already-addressed)
    const created = statsAfter.tasksAutoCreated - statsBefore.tasksAutoCreated
    const dupeSkipped = statsAfter.duplicatesSkipped - statsBefore.duplicatesSkipped
    expect(created + dupeSkipped).toBeGreaterThan(0)
  })
})

describe('Feature family classification', () => {
  let originalConfig: ReturnType<typeof getBridgeConfig>

  beforeEach(() => {
    originalConfig = getBridgeConfig()
    _resetBridgeStats()
    configureBridge({
      assignableAgents: ['link', 'sage'],
      ownershipGuardrail: { enabled: false, requireNonAuthorReviewer: false },
    })
  })

  afterEach(() => {
    configureBridge(originalConfig)
  })

  it('FEATURE_FAMILIES constant includes expected families', () => {
    expect(FEATURE_FAMILIES.has('autonomy')).toBe(true)
    expect(FEATURE_FAMILIES.has('revenue-focus')).toBe(true)
    expect(FEATURE_FAMILIES.has('monetization')).toBe(true)
    expect(FEATURE_FAMILIES.has('runtime-error')).toBe(false)
    expect(FEATURE_FAMILIES.has('deployment')).toBe(false)
  })

  it('routes feature-family insights to triage instead of auto-P0', async () => {
    const suffix = Date.now().toString(36)

    const { insight } = createTestInsight({
      severity: 'high',
      pain: `Feature request monetization ${suffix}`,
      tags: [`stage:ff1-${suffix}`, `family:monetization`, `unit:ff1-${suffix}`],
    })

    // Wait for any EventBus-triggered processing to settle
    await new Promise(r => setTimeout(r, 50))

    const statsBefore = getInsightTaskBridgeStats()
    await _handlePromotedInsight({
      id: `evt-ff1-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id },
    })

    const statsAfter = getInsightTaskBridgeStats()
    // Feature family insight should route to triage (or be caught as duplicate from EventBus)
    const featureRouted = statsAfter.featureRoutedToTriage - statsBefore.featureRoutedToTriage
    const dupeSkipped = statsAfter.duplicatesSkipped - statsBefore.duplicatesSkipped
    // Either the EventBus or our call routed it to triage
    expect(featureRouted + dupeSkipped).toBeGreaterThan(0)
    expect(statsAfter.tasksAutoCreated - statsBefore.tasksAutoCreated).toBe(0)

    const updated = getInsight(insight.id)
    expect(updated?.status).toBe('pending_triage')
  })

  it('auto-creates P0 for bug-family insights', async () => {
    const suffix = Date.now().toString(36)

    const { insight } = createTestInsight({
      severity: 'high',
      pain: `Runtime error crash ${suffix}`,
      tags: [`stage:ff2-${suffix}`, `family:runtime-error`, `unit:ff2-${suffix}`],
    })

    // Wait for EventBus-triggered processing
    await new Promise(r => setTimeout(r, 50))

    const statsBefore = getInsightTaskBridgeStats()
    await _handlePromotedInsight({
      id: `evt-ff2-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id },
    })

    const statsAfter = getInsightTaskBridgeStats()
    // Bug family should auto-create (or EventBus already did it — check dedup)
    const created = statsAfter.tasksAutoCreated - statsBefore.tasksAutoCreated
    const dupeSkipped = statsAfter.duplicatesSkipped - statsBefore.duplicatesSkipped
    expect(created + dupeSkipped).toBeGreaterThan(0)
    expect(statsAfter.featureRoutedToTriage - statsBefore.featureRoutedToTriage).toBe(0)

    const updated = getInsight(insight.id)
    expect(updated?.status).toBe('task_created')
    expect(updated?.task_id).toBeTruthy()
  })

  it('_isFeatureRequest detects feature families', () => {
    const { insight: featureInsight } = createTestInsight({
      tags: ['stage:ifr1', 'family:autonomy', 'unit:ifr1'],
    })
    expect(_isFeatureRequest(featureInsight)).toBe(true)

    const { insight: bugInsight } = createTestInsight({
      tags: ['stage:ifr2', 'family:deployment', 'unit:ifr2'],
    })
    expect(_isFeatureRequest(bugInsight)).toBe(false)
  })

  it('custom featureFamilies config overrides defaults', async () => {
    const suffix = Date.now().toString(36)
    configureBridge({ featureFamilies: new Set(['custom-feature-family']) })

    // 'monetization' should NOT be treated as feature anymore (custom set doesn't include it)
    const { insight } = createTestInsight({
      severity: 'high',
      pain: `Custom family test A ${suffix}`,
      tags: [`stage:cff1-${suffix}`, `family:monetization`, `unit:cff1-${suffix}`],
    })

    // Wait for EventBus
    await new Promise(r => setTimeout(r, 50))

    const statsBefore = getInsightTaskBridgeStats()
    await _handlePromotedInsight({
      id: `evt-cff1-${Date.now()}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: insight.id },
    })

    const statsAfter = getInsightTaskBridgeStats()
    // With custom featureFamilies that doesn't include 'monetization',
    // it should auto-create (or be deduped from EventBus)
    expect(statsAfter.featureRoutedToTriage - statsBefore.featureRoutedToTriage).toBe(0)
    const created = statsAfter.tasksAutoCreated - statsBefore.tasksAutoCreated
    const dupeSkipped = statsAfter.duplicatesSkipped - statsBefore.duplicatesSkipped
    expect(created + dupeSkipped).toBeGreaterThan(0)
  })

  it('bridge stats endpoint includes new fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/insights/bridge/stats' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('alreadyAddressedSkipped')
    expect(body).toHaveProperty('featureRoutedToTriage')
  })
})
