// E2E tests for reflection→insight→task lineage timeline
import { describe, it, expect, beforeAll } from 'vitest'
import Fastify from 'fastify'

describe('Lineage Timeline', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  it('GET /lineage returns entries with timeline + anomaly fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/lineage?limit=10' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('entries')
    expect(body).toHaveProperty('total')
    expect(Array.isArray(body.entries)).toBe(true)
  })

  it('E2E: full chain — reflection → insight → lineage visible', async () => {
    // Step 1: Create a reflection
    const refRes = await app.inject({
      method: 'POST',
      url: '/reflections',
      payload: {
        author: 'lineage-test-agent',
        role_type: 'agent',
        confidence: 9,
        severity: 'high',
        pain: 'Lineage E2E test: pipeline tracing verification',
        impact: 'Must verify full chain from reflection to insight to lineage endpoint',
        evidence: ['lineage-e2e-test-1', 'lineage-e2e-test-2'],
        went_well: 'Fast pipeline execution',
        suspected_why: 'Testing lineage completeness',
        proposed_fix: 'Keep lineage tests green',
        tags: ['stage:testing', 'family:lineage-verification', 'unit:e2e'],
      },
    })
    expect(refRes.statusCode).toBe(201)
    const refBody = JSON.parse(refRes.body)
    expect(refBody.success).toBe(true)
    expect(refBody.insight).not.toBeNull()

    const insightId = refBody.insight.id
    const reflectionId = refBody.reflection.id

    // Step 2: Get lineage by insight ID
    const lineageRes = await app.inject({ method: 'GET', url: `/lineage/${insightId}` })
    expect(lineageRes.statusCode).toBe(200)
    const lineageBody = JSON.parse(lineageRes.body)

    const entry = lineageBody.entry
    expect(entry.chain_id).toBe(insightId)
    expect(entry.reflection).not.toBeNull()
    expect(entry.reflection.id).toBe(reflectionId)
    expect(entry.reflection.author).toBe('lineage-test-agent')
    expect(entry.insight).not.toBeNull()
    expect(entry.insight.id).toBe(insightId)
    expect(entry.insight.score).toBeGreaterThan(0)
    expect(entry.timeline.length).toBeGreaterThanOrEqual(2)

    // Timeline should have reflection_created and insight_created
    const events = entry.timeline.map((t: any) => t.event)
    expect(events).toContain('reflection_created')
    expect(events).toContain('insight_created')

    // Timeline should be chronologically sorted
    for (let i = 1; i < entry.timeline.length; i++) {
      expect(entry.timeline[i].timestamp).toBeGreaterThanOrEqual(entry.timeline[i - 1].timestamp)
    }
  })

  it('GET /lineage/:id by reflection ID returns the chain', async () => {
    // Create a reflection first
    const refRes = await app.inject({
      method: 'POST',
      url: '/reflections',
      payload: {
        author: 'lineage-ref-lookup',
        role_type: 'agent',
        confidence: 6,
        severity: 'medium',
        pain: 'Lookup by reflection ID test',
        impact: 'Should find the parent insight chain',
        evidence: ['ref-lookup-test-1'],
        went_well: 'test running',
        suspected_why: 'testing ref lookup',
        proposed_fix: 'keep working',
        tags: ['stage:test', 'family:lookup-test', 'unit:lineage'],
      },
    })
    const refBody = JSON.parse(refRes.body)
    const reflectionId = refBody.reflection.id

    const lineageRes = await app.inject({ method: 'GET', url: `/lineage/${reflectionId}` })
    expect(lineageRes.statusCode).toBe(200)
    const body = JSON.parse(lineageRes.body)
    expect(body.entry.reflection.id).toBe(reflectionId)
    expect(body.entry.insight).not.toBeNull()
  })

  it('GET /lineage/:id returns 404 for unknown ID', async () => {
    const res = await app.inject({ method: 'GET', url: '/lineage/ins-nonexistent-123' })
    expect(res.statusCode).toBe(404)
  })

  it('GET /lineage?has_anomaly=true filters to anomalous chains', async () => {
    const res = await app.inject({ method: 'GET', url: '/lineage?has_anomaly=true' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    for (const entry of body.entries) {
      expect(entry.anomalies.length).toBeGreaterThan(0)
    }
  })

  it('GET /lineage/stats returns chain statistics', async () => {
    const res = await app.inject({ method: 'GET', url: '/lineage/stats' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('total_chains')
    expect(body).toHaveProperty('with_task')
    expect(body).toHaveProperty('with_anomalies')
    expect(body).toHaveProperty('anomaly_breakdown')
    expect(body.total_chains).toBeGreaterThanOrEqual(0)
  })

  it('lineage entry has correct structure', async () => {
    const res = await app.inject({ method: 'GET', url: '/lineage?limit=1' })
    const body = JSON.parse(res.body)
    if (body.entries.length > 0) {
      const entry = body.entries[0]
      expect(entry).toHaveProperty('chain_id')
      expect(entry).toHaveProperty('reflection')
      expect(entry).toHaveProperty('insight')
      expect(entry).toHaveProperty('task')
      expect(entry).toHaveProperty('promotion')
      expect(entry).toHaveProperty('anomalies')
      expect(entry).toHaveProperty('timeline')
      expect(Array.isArray(entry.anomalies)).toBe(true)
      expect(Array.isArray(entry.timeline)).toBe(true)
    }
  })
})
