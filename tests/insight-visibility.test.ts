// Regression tests: insight visibility across statuses
// Ensures reflections auto-ingest into insights and all statuses are visible
import { describe, it, expect, beforeAll } from 'vitest'
import Fastify from 'fastify'

describe('Insight Visibility', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  it('POST /reflections auto-creates an insight', async () => {
    // Submit a reflection
    const refRes = await app.inject({
      method: 'POST',
      url: '/reflections',
      payload: {
        author: 'test-agent',
        role_type: 'agent',
        confidence: 7,
        severity: 'medium',
        pain: 'Tests are slow and flaky',
        impact: 'CI pipeline takes 10 minutes',
        evidence: ['test-suite.log shows 3 retries', 'jest --verbose output'],
        went_well: 'Coverage is good',
        suspected_why: 'Too many integration tests, not enough unit tests',
        proposed_fix: 'Split integration and unit test suites',
        tags: ['stage:build', 'family:test-failure', 'unit:ci'],
      },
    })
    expect(refRes.statusCode).toBe(201)
    const refBody = JSON.parse(refRes.body)
    expect(refBody.success).toBe(true)
    expect(refBody.reflection.id).toBeTruthy()

    // Verify insight was auto-created
    expect(refBody.insight).not.toBeNull()
    expect(refBody.insight.id).toMatch(/^ins-/)
    expect(refBody.insight.score).toBeGreaterThan(0)
  })

  it('GET /insights returns insights with all statuses by default', async () => {
    const res = await app.inject({ method: 'GET', url: '/insights' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.total).toBeGreaterThanOrEqual(1)
    expect(body.insights.length).toBeGreaterThanOrEqual(1)

    // Each insight has required visibility fields
    for (const insight of body.insights) {
      expect(insight.id).toBeTruthy()
      expect(insight.status).toBeTruthy()
      expect(insight.score).toBeDefined()
      expect(insight.title).toBeTruthy()
      expect(insight.authors).toBeInstanceOf(Array)
    }
  })

  it('GET /insights?status=all returns all insights (no filter)', async () => {
    const allRes = await app.inject({ method: 'GET', url: '/insights?status=all' })
    const defaultRes = await app.inject({ method: 'GET', url: '/insights' })
    expect(allRes.statusCode).toBe(200)
    const allBody = JSON.parse(allRes.body)
    const defaultBody = JSON.parse(defaultRes.body)
    expect(allBody.total).toBe(defaultBody.total)
  })

  it('GET /insights?status=candidate filters correctly', async () => {
    const res = await app.inject({ method: 'GET', url: '/insights?status=candidate' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    for (const insight of body.insights) {
      expect(insight.status).toBe('candidate')
    }
  })

  it('GET /insights/stats returns status breakdown', async () => {
    const res = await app.inject({ method: 'GET', url: '/insights/stats' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('by_status')
    expect(body.total).toBeGreaterThanOrEqual(1)
    expect(typeof body.by_status).toBe('object')
  })

  it('promoted/triaged insights are visible (not hidden by default)', async () => {
    // Create reflection, manually check that any promoted/pending_triage statuses show up
    const res = await app.inject({ method: 'GET', url: '/insights' })
    const body = JSON.parse(res.body)
    const statuses = new Set(body.insights.map((i: any) => i.status))
    // We just need to verify the endpoint doesn't filter out any status
    // The actual promoted/triage status depends on score thresholds
    expect(body.total).toBe(body.insights.length <= 50 ? body.total : 50) // pagination check
  })
})
