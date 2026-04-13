// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { getCapabilityReadiness } from '../src/capability-readiness.js'

const baseOpts = {
  cloudConnected: false,
  cloudUrl: '',
  webhooks: [] as Array<{ provider: string; active: boolean }>,
}

describe('capability readiness contract', () => {
  it('returns report with all 6 capabilities', () => {
    const report = getCapabilityReadiness(baseOpts)
    const names = report.capabilities.map(c => c.capability)
    expect(names).toContain('browser')
    expect(names).toContain('search')
    expect(names).toContain('email')
    expect(names).toContain('sms')
    expect(names).toContain('calendar')
    expect(names).toContain('models')
    expect(report.capabilities).toHaveLength(6)
  })

  it('report has checked_at timestamp', () => {
    const before = Date.now()
    const report = getCapabilityReadiness(baseOpts)
    expect(report.checked_at).toBeGreaterThanOrEqual(before)
    expect(report.checked_at).toBeLessThanOrEqual(Date.now())
  })

  it('email is not_ready when cloud disconnected', () => {
    const report = getCapabilityReadiness({ ...baseOpts, cloudConnected: false })
    const email = report.capabilities.find(c => c.capability === 'email')!
    expect(email.status).toBe('not_ready')
    expect(email.last_error).not.toBeNull()
    expect(email.hint).not.toBeNull()
  })

  it('email is degraded when cloud connected but no inbound webhook', () => {
    const report = getCapabilityReadiness({ ...baseOpts, cloudConnected: true, cloudUrl: 'https://api.reflectt.ai' })
    const email = report.capabilities.find(c => c.capability === 'email')!
    expect(email.status).toBe('degraded')
  })

  it('email is ready when cloud connected + resend webhook active', () => {
    const webhooks = [{ provider: 'resend', active: true }]
    const report = getCapabilityReadiness({ ...baseOpts, cloudConnected: true, cloudUrl: 'https://api.reflectt.ai', webhooks })
    const email = report.capabilities.find(c => c.capability === 'email')!
    expect(email.status).toBe('ready')
    expect(email.last_error).toBeNull()
    expect(email.hint).toBeNull()
  })

  it('sms is not_ready when cloud disconnected', () => {
    const report = getCapabilityReadiness(baseOpts)
    const sms = report.capabilities.find(c => c.capability === 'sms')!
    expect(sms.status).toBe('not_ready')
  })

  it('sms is ready when cloud connected + twilio webhook active', () => {
    const webhooks = [{ provider: 'twilio', active: true }]
    const report = getCapabilityReadiness({ ...baseOpts, cloudConnected: true, cloudUrl: 'https://api.reflectt.ai', webhooks })
    const sms = report.capabilities.find(c => c.capability === 'sms')!
    expect(sms.status).toBe('ready')
  })

  it('calendar is always ready (no external deps required)', () => {
    const report = getCapabilityReadiness(baseOpts)
    const cal = report.capabilities.find(c => c.capability === 'calendar')!
    expect(cal.status).toBe('ready')
  })

  it('browser is ready when cloud connected (managed relay path)', () => {
    const report = getCapabilityReadiness({ ...baseOpts, cloudConnected: true, cloudUrl: 'https://api.reflectt.ai' })
    const browser = report.capabilities.find(c => c.capability === 'browser')!
    expect(browser.status).toBe('ready')
    expect(browser.last_error).toBeNull()
    expect(browser.hint).toBeNull()
    const relayDep = browser.dependencies.find(d => d.name === 'managed_relay')
    expect(relayDep?.status).toBe('ok')
  })

  it('browser is not_ready or degraded when not cloud connected and no local Stagehand', () => {
    const report = getCapabilityReadiness(baseOpts)
    const browser = report.capabilities.find(c => c.capability === 'browser')!
    // standalone without stagehand installed → not_ready; without LLM key only → degraded
    expect(['not_ready', 'degraded']).toContain(browser.status)
  })

  it('each capability has non-empty dependencies array with valid statuses', () => {
    const report = getCapabilityReadiness(baseOpts)
    for (const cap of report.capabilities) {
      expect(Array.isArray(cap.dependencies), `${cap.capability} missing dependencies`).toBe(true)
      expect(cap.dependencies.length, `${cap.capability} empty dependencies`).toBeGreaterThan(0)
      for (const dep of cap.dependencies) {
        expect(['ok', 'missing', 'error']).toContain(dep.status)
      }
    }
  })

  it('overall is not_ready when any capability is not_ready', () => {
    const report = getCapabilityReadiness(baseOpts)
    expect(report.overall).toBe('not_ready')
  })

  it('email transitions not_ready → ready after config fixed (e2e test)', () => {
    const before = getCapabilityReadiness(baseOpts)
    const emailBefore = before.capabilities.find(c => c.capability === 'email')!
    expect(emailBefore.status).toBe('not_ready')

    const after = getCapabilityReadiness({
      cloudConnected: true,
      cloudUrl: 'https://api.reflectt.ai',
      webhooks: [{ provider: 'resend', active: true }],
    })
    const emailAfter = after.capabilities.find(c => c.capability === 'email')!
    expect(emailAfter.status).toBe('ready')
  })

  it('non-browser capabilities all ready with full config', () => {
    const webhooks = [
      { provider: 'resend', active: true },
      { provider: 'twilio', active: true },
    ]
    const report = getCapabilityReadiness({ cloudConnected: true, cloudUrl: 'https://api.reflectt.ai', webhooks, samplingProviders: ['claude'] })
    // browser and search are node-managed — their readiness depends on local env vars not set in tests
    const nonNodeManaged = report.capabilities.filter(c => c.capability !== 'browser' && c.capability !== 'search')
    for (const cap of nonNodeManaged) {
      expect(cap.status, `${cap.capability} should be ready`).toBe('ready')
    }
  })
})
