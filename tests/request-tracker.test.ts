// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from 'vitest'
import { trackRequest, trackError, getRequestMetrics, resetRequestMetrics } from '../src/request-tracker.js'

describe('request-tracker', () => {
  beforeEach(() => {
    resetRequestMetrics()
  })

  it('tracks total request count', () => {
    trackRequest('GET', '/health', 200)
    trackRequest('GET', '/tasks', 200)
    trackRequest('POST', '/tasks', 201)
    const m = getRequestMetrics()
    expect(m.total).toBe(3)
    expect(m.errors).toBe(0)
  })

  it('classifies requests by endpoint group', () => {
    trackRequest('GET', '/health', 200)
    trackRequest('GET', '/health/system', 200)
    trackRequest('GET', '/bootstrap/team', 200)
    trackRequest('GET', '/tasks/next', 200)
    trackRequest('POST', '/chat/send', 200)
    const m = getRequestMetrics()
    expect(m.byGroup.health!.requests).toBe(2)
    expect(m.byGroup.bootstrap!.requests).toBe(1)
    expect(m.byGroup.tasks!.requests).toBe(1)
    expect(m.byGroup.chat!.requests).toBe(1)
  })

  it('classifies new route groups correctly', () => {
    trackRequest('GET', '/heartbeat/link', 200)
    trackRequest('GET', '/inbox/link', 200)
    trackRequest('GET', '/reflections', 200)
    trackRequest('GET', '/insights', 200)
    trackRequest('GET', '/hosts', 200)
    trackRequest('POST', '/presence/link', 200)
    trackRequest('GET', '/shared/list', 404)
    trackRequest('GET', '/avatars/link.png', 404)
    trackRequest('GET', '/dashboard', 200)
    trackRequest('GET', '/memory/link', 200)
    trackRequest('GET', '/preflight', 200)
    trackRequest('GET', '/policy', 200)
    const m = getRequestMetrics()
    expect(m.byGroup.heartbeat!.requests).toBe(1)
    expect(m.byGroup.inbox!.requests).toBe(1)
    expect(m.byGroup.reflections!.requests).toBe(1)
    expect(m.byGroup.insights!.requests).toBe(1)
    expect(m.byGroup.hosts!.requests).toBe(1)
    expect(m.byGroup.presence!.requests).toBe(1)
    expect(m.byGroup.shared!.requests).toBe(1)
    expect(m.byGroup.shared!.errors).toBe(1)
    expect(m.byGroup.avatars!.requests).toBe(1)
    expect(m.byGroup.avatars!.errors).toBe(1)
    expect(m.byGroup.dashboard!.requests).toBe(1)
    expect(m.byGroup.memory!.requests).toBe(1)
    expect(m.byGroup.preflight!.requests).toBe(1)
    expect(m.byGroup.policy!.requests).toBe(1)
    // None should land in "other"
    expect(m.byGroup.other).toBeUndefined()
  })

  it('tracks 4xx as errors in counts', () => {
    trackRequest('POST', '/tasks', 400)
    trackRequest('GET', '/health', 200)
    const m = getRequestMetrics()
    expect(m.errors).toBe(1)
    expect(m.byGroup.tasks!.errors).toBe(1)
    expect(m.byGroup.health!.errors).toBe(0)
  })

  it('stores 5xx errors in recentErrors', () => {
    trackRequest('GET', '/health', 500, 'curl/7.81')
    const m = getRequestMetrics()
    expect(m.recentErrors).toHaveLength(1)
    expect(m.recentErrors[0]!.status).toBe(500)
    expect(m.recentErrors[0]!.method).toBe('GET')
    expect(m.recentErrors[0]!.userAgent).toBe('curl/7.81')
  })

  it('does not store 4xx in recentErrors (only 5xx)', () => {
    trackRequest('POST', '/tasks', 400)
    trackRequest('POST', '/tasks', 404)
    const m = getRequestMetrics()
    expect(m.recentErrors).toHaveLength(0)
  })

  it('caps recentErrors at 20', () => {
    for (let i = 0; i < 25; i++) {
      trackRequest('GET', `/fail-${i}`, 500)
    }
    const m = getRequestMetrics()
    expect(m.recentErrors).toHaveLength(20)
    // Most recent first
    expect(m.recentErrors[0]!.url).toBe('/fail-24')
  })

  it('calculates rps', () => {
    trackRequest('GET', '/health', 200)
    trackRequest('GET', '/health', 200)
    const m = getRequestMetrics()
    expect(m.rps).toBeGreaterThan(0)
    expect(m.uptimeMs).toBeGreaterThan(0)
  })

  it('tracks internal errors via trackError', () => {
    trackError('cloud-sync', new Error('connection refused'))
    const m = getRequestMetrics()
    expect(m.errors).toBe(1)
    expect(m.recentErrors).toHaveLength(1)
    expect(m.recentErrors[0]!.method).toBe('INTERNAL')
    expect(m.recentErrors[0]!.message).toContain('connection refused')
  })

  it('resets cleanly', () => {
    trackRequest('GET', '/health', 200)
    trackRequest('GET', '/health', 500)
    resetRequestMetrics()
    const m = getRequestMetrics()
    expect(m.total).toBe(0)
    expect(m.errors).toBe(0)
    expect(m.recentErrors).toHaveLength(0)
    expect(m.rolling.requests).toBe(0)
    expect(m.rolling.errors).toBe(0)
  })

  it('truncates long URLs', () => {
    const longUrl = '/health/' + 'x'.repeat(300)
    trackRequest('GET', longUrl, 500)
    const m = getRequestMetrics()
    expect(m.recentErrors[0]!.url.length).toBeLessThanOrEqual(201) // 200 + ellipsis
  })

  describe('rolling window', () => {
    it('includes rolling metrics in output', () => {
      trackRequest('GET', '/health', 200)
      trackRequest('GET', '/tasks', 400)
      const m = getRequestMetrics()
      expect(m.rolling).toBeDefined()
      expect(m.rolling.requests).toBe(2)
      expect(m.rolling.errors).toBe(1)
      expect(m.rolling.errorRate).toBe(50)
      expect(m.rolling.windowMinutes).toBe(60)
    })

    it('shows 0% error rate when all requests succeed', () => {
      trackRequest('GET', '/health', 200)
      trackRequest('GET', '/health', 200)
      trackRequest('GET', '/health', 200)
      const m = getRequestMetrics()
      expect(m.rolling.errorRate).toBe(0)
    })

    it('shows 0 for empty window', () => {
      const m = getRequestMetrics()
      expect(m.rolling.requests).toBe(0)
      expect(m.rolling.errors).toBe(0)
      expect(m.rolling.errorRate).toBe(0)
    })

    it('only includes groups with traffic', () => {
      trackRequest('GET', '/health', 200)
      const m = getRequestMetrics()
      // health should be present
      expect(m.byGroup.health).toBeDefined()
      // mcp with no traffic should not be present
      expect(m.byGroup.mcp).toBeUndefined()
    })
  })
})
