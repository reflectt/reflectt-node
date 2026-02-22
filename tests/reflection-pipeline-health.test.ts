// Reflection→Insight pipeline health checks
import { describe, it, expect, beforeAll } from 'vitest'
import Fastify from 'fastify'

describe('Reflection Pipeline Health', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  it('reports reflection pipeline health metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/reflection-pipeline' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    expect(body).toHaveProperty('status')
    expect(body).toHaveProperty('recentReflections')
    expect(body).toHaveProperty('recentInsights')
    expect(body).toHaveProperty('recentPromotions')
    expect(body).toHaveProperty('signals')
    expect(body.signals).toHaveProperty('reflections_flowing')
    expect(body.signals).toHaveProperty('insights_flowing')
  })

  it('no-drop regression: posted reflection appears in insights list', async () => {
    const refRes = await app.inject({
      method: 'POST',
      url: '/reflections',
      payload: {
        author: 'pipeline-test',
        role_type: 'agent',
        confidence: 8,
        severity: 'high',
        pain: 'Pipeline reliability test reflection',
        impact: 'Ensures no silent drop between reflection and insight',
        evidence: ['pipeline-health-test-1'],
        went_well: 'fast test execution',
        suspected_why: 'need regression guard',
        proposed_fix: 'keep this test',
        tags: ['stage:ops', 'family:reliability', 'unit:pipeline'],
      },
    })

    expect(refRes.statusCode).toBe(201)
    const refBody = JSON.parse(refRes.body)
    expect(refBody.success).toBe(true)
    expect(refBody.insight).not.toBeNull()

    const insightId = refBody.insight.id

    const insightsRes = await app.inject({ method: 'GET', url: '/insights?limit=200' })
    expect(insightsRes.statusCode).toBe(200)
    const insightsBody = JSON.parse(insightsRes.body)

    const found = insightsBody.insights.some((i: any) => i.id === insightId)
    expect(found).toBe(true)
  })
})
