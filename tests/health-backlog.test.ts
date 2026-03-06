import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('GET /health/backlog', () => {
  it('returns 200 with valid structure', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/backlog' })
    expect(res.statusCode).toBe(200)

    const body = JSON.parse(res.body)
    expect(body.summary).toBeDefined()
    expect(body.lanes).toBeDefined()
    expect(Array.isArray(body.lanes)).toBe(true)
    expect(typeof body.timestamp).toBe('number')
  })

  it('summary contains no null counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/backlog' })
    const body = JSON.parse(res.body)
    const summary = body.summary

    // All required summary fields must be numeric (never null/undefined)
    const requiredNumericFields = [
      'totalReady',
      'totalNotReady',
      'totalDoing',
      'totalValidating',
      'totalBlocked',
      'breachedLaneCount',
      'staleValidatingCount',
    ]

    for (const field of requiredNumericFields) {
      expect(summary[field], `summary.${field} must be a number, got ${summary[field]}`).not.toBeNull()
      expect(typeof summary[field], `summary.${field} must be a number`).toBe('number')
      expect(Number.isFinite(summary[field]), `summary.${field} must be finite`).toBe(true)
    }

    // overallStatus must be a non-empty string
    expect(typeof summary.overallStatus).toBe('string')
    expect(summary.overallStatus.length).toBeGreaterThan(0)
    expect(['healthy', 'warning', 'breach', 'critical']).toContain(summary.overallStatus)
  })

  it('each lane has numeric counts (no nulls)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/backlog' })
    const body = JSON.parse(res.body)

    for (const lane of body.lanes) {
      expect(typeof lane.lane).toBe('string')
      expect(Array.isArray(lane.agents)).toBe(true)
      expect(typeof lane.readyFloor).toBe('number')

      // All count fields must be numeric
      const countFields = [
        'todo', 'ready', 'notReady', 'doing',
        'validating', 'blocked', 'done', 'resolvedExternally',
      ]

      for (const field of countFields) {
        expect(
          lane.counts[field],
          `lane "${lane.lane}" counts.${field} must be a number, got ${lane.counts[field]}`,
        ).not.toBeNull()
        expect(typeof lane.counts[field], `lane "${lane.lane}" counts.${field}`).toBe('number')
      }

      // Compliance must have a valid status
      expect(lane.compliance).toBeDefined()
      expect(typeof lane.compliance.status).toBe('string')
      expect(['healthy', 'warning', 'breach']).toContain(lane.compliance.status)
    }
  })

  it('breachedLaneCount matches actual breached lanes', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/backlog' })
    const body = JSON.parse(res.body)

    const actualBreaches = body.lanes.filter(
      (l: { compliance: { status: string } }) => l.compliance.status === 'breach',
    ).length
    expect(body.summary.breachedLaneCount).toBe(actualBreaches)
  })
})
