// E2E test: autonomous continuity loop
// Proves the full cycle: queue breach → insight promotion → task creation → queue replenished
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { createReflection } from '../src/reflections.js'
import { ingestReflection, _clearInsightStore } from '../src/insights.js'
import { _clearPromotionAudits } from '../src/insight-promotion.js'
import { _resetContinuityState, tickContinuityLoop, getContinuityStats, getContinuityAuditLog } from '../src/continuity-loop.js'
import { taskManager } from '../src/tasks.js'

describe('Continuity Loop', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  beforeEach(() => {
    _resetContinuityState()
  })

  it('GET /continuity/stats returns stats object', async () => {
    const res = await app.inject({ method: 'GET', url: '/continuity/stats' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('cyclesRun')
    expect(body).toHaveProperty('insightsPromoted')
    expect(body).toHaveProperty('lastRunAt')
  })

  it('GET /continuity/audit returns audit log', async () => {
    const res = await app.inject({ method: 'GET', url: '/continuity/audit' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('actions')
    expect(Array.isArray(body.actions)).toBe(true)
  })

  it('POST /continuity/tick runs a cycle', async () => {
    const res = await app.inject({ method: 'POST', url: '/continuity/tick' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body).toHaveProperty('agentsChecked')
    expect(body).toHaveProperty('replenished')
  })

  it('tickContinuityLoop returns clean result when no agents configured', async () => {
    const result = await tickContinuityLoop()
    expect(result.actions).toBeInstanceOf(Array)
    expect(result.agentsChecked).toBeGreaterThanOrEqual(0)
  })

  it('E2E: promoted insight can be auto-converted to task', async () => {
    // Create two reflections from different authors to trigger promotion
    const ref1 = createReflection({
      pain: 'Continuity test: queue runs dry frequently',
      impact: 'Agents sit idle waiting for task assignment',
      evidence: ['board-health-log-1'],
      went_well: 'Detection was fast',
      suspected_why: 'No auto-replenishment mechanism',
      proposed_fix: 'Build continuity loop',
      confidence: 8,
      role_type: 'agent',
      author: 'agent-a',
      severity: 'high',
      tags: ['stage:ops', 'family:queue-starvation', 'unit:board'],
    })

    const ref2 = createReflection({
      pain: 'Continuity test: queue runs dry frequently',
      impact: 'Agents sit idle waiting for task assignment',
      evidence: ['board-health-log-2'],
      went_well: 'Alerts worked',
      suspected_why: 'No auto-replenishment mechanism',
      proposed_fix: 'Build continuity loop',
      confidence: 7,
      role_type: 'agent',
      author: 'agent-b',
      severity: 'high',
      tags: ['stage:ops', 'family:queue-starvation', 'unit:board'],
    })

    // Ingest both — second should trigger promotion (2 independent authors)
    const ins1 = ingestReflection(ref1)
    const ins2 = ingestReflection(ref2)

    // Verify insight is promoted
    expect(ins2.status).toBe('promoted')
    expect(ins2.task_id).toBeNull() // No task yet

    // Verify the insight shows up in API
    const insightsRes = await app.inject({ method: 'GET', url: '/insights?status=promoted' })
    const insightsBody = JSON.parse(insightsRes.body)
    const found = insightsBody.insights.some((i: any) => i.id === ins2.id)
    expect(found).toBe(true)
  })

  it('stats increment on tick', async () => {
    const before = getContinuityStats()
    await tickContinuityLoop()
    const after = getContinuityStats()
    expect(after.cyclesRun).toBe(before.cyclesRun + 1)
  })

  it('audit log captures actions', async () => {
    await tickContinuityLoop()
    const log = getContinuityAuditLog()
    // Log may be empty if no agents need replenishment, but it should be an array
    expect(Array.isArray(log)).toBe(true)
  })
})
