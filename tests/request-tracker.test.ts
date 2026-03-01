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
    expect(m.byGroup.health.requests).toBe(2)
    expect(m.byGroup.bootstrap.requests).toBe(1)
    expect(m.byGroup.tasks.requests).toBe(1)
    expect(m.byGroup.chat.requests).toBe(1)
  })

  it('tracks 4xx as errors in counts', () => {
    trackRequest('POST', '/tasks', 400)
    trackRequest('GET', '/health', 200)
    const m = getRequestMetrics()
    expect(m.errors).toBe(1)
    expect(m.byGroup.tasks.errors).toBe(1)
    expect(m.byGroup.health.errors).toBe(0)
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
  })

  it('truncates long URLs', () => {
    const longUrl = '/health/' + 'x'.repeat(300)
    trackRequest('GET', longUrl, 500)
    const m = getRequestMetrics()
    expect(m.recentErrors[0]!.url.length).toBeLessThanOrEqual(201) // 200 + ellipsis
  })
})
