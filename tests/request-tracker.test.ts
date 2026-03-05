import { describe, it, expect, beforeEach } from 'vitest'
import { trackRequest, trackError, getRequestMetrics, resetRequestMetrics } from '../src/request-tracker.js'

describe('request-tracker', () => {
  beforeEach(() => {
    resetRequestMetrics()
  })

  it('tracks successful requests', () => {
    trackRequest('GET', '/health', 200)
    trackRequest('GET', '/tasks', 200)
    const m = getRequestMetrics()
    expect(m.total).toBe(2)
    expect(m.errors).toBe(0)
    expect(m.byGroup.health.requests).toBe(1)
    expect(m.byGroup.tasks.requests).toBe(1)
  })

  it('tracks 4xx errors in recentErrors (except 404)', () => {
    trackRequest('POST', '/tasks', 400, 'test-agent')
    trackRequest('GET', '/tasks/missing', 404)
    trackRequest('PUT', '/tasks/123', 422, 'test-agent')

    const m = getRequestMetrics()
    expect(m.errors).toBe(3)
    // 404s are excluded from recentErrors to reduce noise
    expect(m.recentErrors).toHaveLength(2)
    expect(m.recentErrors[0].status).toBe(422) // most recent first
    expect(m.recentErrors[1].status).toBe(400)
  })

  it('tracks 5xx errors in recentErrors', () => {
    trackRequest('GET', '/health', 500)
    const m = getRequestMetrics()
    expect(m.recentErrors).toHaveLength(1)
    expect(m.recentErrors[0].status).toBe(500)
    expect(m.recentErrors[0].method).toBe('GET')
  })

  it('populates topErrorBuckets with route+status counts', () => {
    trackRequest('GET', '/tasks/1', 400)
    trackRequest('GET', '/tasks/2', 400)
    trackRequest('GET', '/tasks/3', 400)
    trackRequest('POST', '/chat', 500)

    const m = getRequestMetrics()
    expect(m.topErrorBuckets.length).toBeGreaterThanOrEqual(2)
    // tasks:400 should be top bucket (3 hits)
    expect(m.topErrorBuckets[0].group).toBe('tasks')
    expect(m.topErrorBuckets[0].status).toBe(400)
    expect(m.topErrorBuckets[0].count).toBe(3)
  })

  it('trackError records internal errors', () => {
    trackError('test-context', new Error('boom'))
    const m = getRequestMetrics()
    expect(m.errors).toBe(1)
    expect(m.recentErrors).toHaveLength(1)
    expect(m.recentErrors[0].method).toBe('INTERNAL')
    expect(m.recentErrors[0].message).toContain('boom')
  })

  it('caps recentErrors at MAX_ERRORS', () => {
    for (let i = 0; i < 25; i++) {
      trackRequest('GET', `/tasks/${i}`, 500)
    }
    const m = getRequestMetrics()
    expect(m.recentErrors.length).toBeLessThanOrEqual(20)
  })

  it('rolling metrics track recent window', () => {
    trackRequest('GET', '/health', 200)
    trackRequest('GET', '/tasks', 500)
    const m = getRequestMetrics()
    expect(m.rolling.requests).toBe(2)
    expect(m.rolling.errors).toBe(1)
    expect(m.rolling.windowMinutes).toBe(60)
  })

  it('resetRequestMetrics clears all state', () => {
    trackRequest('GET', '/health', 500)
    trackError('ctx', 'err')
    resetRequestMetrics()
    const m = getRequestMetrics()
    expect(m.total).toBe(0)
    expect(m.errors).toBe(0)
    expect(m.recentErrors).toHaveLength(0)
    expect(m.topErrorBuckets).toHaveLength(0)
  })
})
