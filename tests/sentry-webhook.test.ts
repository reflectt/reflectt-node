import { describe, it, expect } from 'vitest'
import { formatSentryAlert, verifySentrySignature } from '../src/sentry-webhook.js'

describe('formatSentryAlert', () => {
  it('formats a triggered issue alert', () => {
    const result = formatSentryAlert({
      action: 'triggered',
      data: {
        issue: {
          id: '12345',
          title: 'TypeError: Cannot read property of undefined',
          culprit: 'src/server.ts',
          metadata: { filename: 'src/server.ts', function: 'handleRequest' },
          count: '42',
          shortId: 'REFLECTT-1A',
          project: { slug: 'reflectt-node', name: 'reflectt-node', id: '1' },
          level: 'error',
        },
        triggered_rule: 'All errors',
      },
    })

    expect(result).toContain('Triggered')
    expect(result).toContain('TypeError: Cannot read property of undefined')
    expect(result).toContain('reflectt-node')
    expect(result).toContain('REFLECTT-1A')
    expect(result).toContain('42 event(s)')
    expect(result).toContain('src/server.ts in handleRequest')
    expect(result).toContain('All errors')
    expect(result).toContain('https://sentry.io/issues/12345/')
  })

  it('formats a resolved issue alert', () => {
    const result = formatSentryAlert({
      action: 'resolved',
      data: {
        issue: {
          id: '999',
          title: 'ReferenceError: x is not defined',
          project: { slug: 'reflectt-node', name: 'reflectt-node', id: '1' },
          level: 'error',
          count: '5',
          shortId: 'REFLECTT-2B',
        },
      },
    })

    expect(result).toContain('✅ Resolved')
    expect(result).toContain('ReferenceError: x is not defined')
  })

  it('formats a metric alert', () => {
    const result = formatSentryAlert({
      action: 'triggered',
      data: {
        metric_alert: {
          id: '1',
          title: 'High error rate',
          alert_rule: { id: 1, name: 'Error rate > 5%' },
          status: 'critical',
        },
      },
    })

    expect(result).toContain('Metric Alert')
    expect(result).toContain('Error rate > 5%')
    expect(result).toContain('critical')
  })

  it('returns null for installation webhooks', () => {
    const result = formatSentryAlert({
      action: 'created',
      data: {},
    })
    expect(result).toBeNull()
  })

  it('handles missing fields gracefully', () => {
    const result = formatSentryAlert({
      action: 'triggered',
      data: {
        issue: {
          title: 'Some error',
          level: 'warning',
        },
      },
    })

    expect(result).toContain('🟡')
    expect(result).toContain('Some error')
    expect(result).not.toContain('undefined')
  })

  it('handles fatal level with skull emoji', () => {
    const result = formatSentryAlert({
      action: 'triggered',
      data: {
        issue: {
          title: 'OOM Crash',
          level: 'fatal',
          count: '1',
          project: { slug: 'reflectt-node', name: 'reflectt-node', id: '1' },
        },
      },
    })

    expect(result).toContain('💀')
  })
})

describe('verifySentrySignature', () => {
  it('accepts when no secret is configured', () => {
    expect(verifySentrySignature('{}', undefined, undefined)).toBe(true)
  })

  it('rejects when secret is set but no signature header', () => {
    expect(verifySentrySignature('{}', undefined, 'my-secret')).toBe(false)
  })

  it('verifies valid HMAC-SHA256 signature', () => {
    const crypto = require('crypto')
    const body = '{"action":"triggered"}'
    const secret = 'test-secret-key'
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')

    expect(verifySentrySignature(body, sig, secret)).toBe(true)
  })

  it('rejects invalid signature', () => {
    expect(verifySentrySignature('{"action":"triggered"}', 'bad-sig-value', 'my-secret')).toBe(false)
  })
})
