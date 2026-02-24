import { describe, it, expect, beforeEach } from 'vitest'
import {
  runPreflight,
  formatPreflightReport,
  _checkNodeVersion,
  _checkHomeWritable,
  _checkPortAvailable,
  _checkCloudReachable,
  _checkAuthValid,
  type PreflightReport,
  type PreflightResult,
} from '../src/preflight.js'
import {
  getUserFunnelState,
  resetActivationFunnel,
} from '../src/activationEvents.js'

// ── Helpers ──

function findCheck(report: PreflightReport, id: string): PreflightResult | undefined {
  return report.results.find(r => r.check.id === id)
}

// ── Individual Check Tests ──

describe('Preflight: individual checks', () => {

  it('checkNodeVersion passes on Node >= 20', () => {
    const result = _checkNodeVersion()
    const [major] = process.versions.node.split('.').map(Number)
    expect(result.passed).toBe(major >= 20)
    expect(result.check.id).toBe('node-version')
    expect(result.check.category).toBe('version')
    expect(result.message).toContain(process.versions.node)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.details?.version).toBe(process.versions.node)
  })

  it('checkHomeWritable checks REFLECTT_HOME', () => {
    const result = _checkHomeWritable()
    expect(result.check.id).toBe('home-writable')
    expect(result.check.category).toBe('system')
    expect(typeof result.passed).toBe('boolean')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    if (!result.passed) {
      expect(result.recovery).toBeDefined()
      expect(result.recovery!.length).toBeGreaterThan(0)
    }
  })

  it('checkPortAvailable succeeds on unused port', async () => {
    const result = await _checkPortAvailable(59123)
    expect(result.check.id).toBe('port-available')
    expect(result.check.category).toBe('system')
    expect(result.passed).toBe(true)
    expect(result.details?.port).toBe(59123)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('checkPortAvailable fails when port is in use', async () => {
    const { createServer } = await import('node:net')
    const server = createServer()

    await new Promise<void>((resolve) => {
      server.listen(59124, '127.0.0.1', () => resolve())
    })

    try {
      const result = await _checkPortAvailable(59124)
      expect(result.passed).toBe(false)
      expect(result.message).toContain('59124')
      expect(result.message).toContain('in use')
      expect(result.recovery).toBeDefined()
      expect(result.recovery!.length).toBeGreaterThan(0)
      expect(result.recovery!.some(s => s.includes('lsof') || s.includes('stop'))).toBe(true)
    } finally {
      server.close()
    }
  })

  it('checkCloudReachable fails on invalid domain', async () => {
    const result = await _checkCloudReachable('https://definitely-not-real-12345.invalid')
    expect(result.check.id).toBe('cloud-reachable')
    expect(result.check.category).toBe('network')
    expect(result.passed).toBe(false)
    expect(result.recovery).toBeDefined()
    expect(result.recovery!.length).toBeGreaterThan(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('checkAuthValid fails with no credentials', async () => {
    const result = await _checkAuthValid({})
    expect(result.check.id).toBe('auth-valid')
    expect(result.check.category).toBe('auth')
    expect(result.passed).toBe(false)
    expect(result.message).toContain('No authentication')
    expect(result.recovery).toBeDefined()
    expect(result.recovery!.some(s => s.includes('join-token') || s.includes('api-key'))).toBe(true)
  })

  it('checkAuthValid rejects malformed short token', async () => {
    const result = await _checkAuthValid({ joinToken: 'abc' })
    expect(result.passed).toBe(false)
    expect(result.message).toContain('malformed')
    expect(result.recovery).toBeDefined()
  })

  it('checkAuthValid rejects malformed short API key', async () => {
    const result = await _checkAuthValid({ apiKey: 'short' })
    expect(result.passed).toBe(false)
    expect(result.message).toContain('malformed')
    expect(result.recovery).toBeDefined()
  })
})

// ── Full Preflight Report Tests ──

describe('Preflight: runPreflight integration', () => {

  it('returns structured report with all system checks', async () => {
    const report = await runPreflight({ skipNetwork: true })
    expect(report.timestamp).toBeGreaterThan(0)
    expect(typeof report.allPassed).toBe('boolean')
    expect(report.results.length).toBeGreaterThanOrEqual(3)
    expect(report.summary).toBeTruthy()

    for (const result of report.results) {
      expect(result.check.id).toBeTruthy()
      expect(result.check.name).toBeTruthy()
      expect(result.check.description).toBeTruthy()
      expect(result.check.category).toBeTruthy()
      expect(typeof result.passed).toBe('boolean')
      expect(result.message).toBeTruthy()
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('includes node-version, home-writable, and port checks', async () => {
    const report = await runPreflight({ skipNetwork: true })
    expect(findCheck(report, 'node-version')).toBeDefined()
    expect(findCheck(report, 'home-writable')).toBeDefined()
    expect(findCheck(report, 'port-available')).toBeDefined()
  })

  it('includes cloud-reachable when network not skipped', async () => {
    const report = await runPreflight({
      cloudUrl: 'https://definitely-not-real-12345.invalid',
    })
    expect(findCheck(report, 'cloud-reachable')).toBeDefined()
  })

  it('skips network checks when skipNetwork=true', async () => {
    const report = await runPreflight({ skipNetwork: true })
    expect(findCheck(report, 'cloud-reachable')).toBeUndefined()
    expect(findCheck(report, 'auth-valid')).toBeUndefined()
  })

  it('includes auth check when joinToken provided', async () => {
    const report = await runPreflight({
      cloudUrl: 'https://definitely-not-real-12345.invalid',
      joinToken: 'test-token-long-enough-to-pass-format-check',
    })
    expect(findCheck(report, 'auth-valid')).toBeDefined()
  })

  it('includes auth check when apiKey provided', async () => {
    const report = await runPreflight({
      cloudUrl: 'https://definitely-not-real-12345.invalid',
      apiKey: 'test-api-key-long-enough-to-pass-format-check',
    })
    expect(findCheck(report, 'auth-valid')).toBeDefined()
  })

  it('reports firstBlocker on failure', async () => {
    const report = await runPreflight({
      cloudUrl: 'https://definitely-not-real-12345.invalid',
    })

    if (!report.allPassed) {
      expect(report.firstBlocker).toBeDefined()
      expect(report.firstBlocker!.check).toBeTruthy()
      expect(report.firstBlocker!.message).toBeTruthy()
      expect(report.firstBlocker!.recovery.length).toBeGreaterThan(0)
    }
  })

  it('summary indicates pass or fail count', async () => {
    const report = await runPreflight({ skipNetwork: true })
    if (report.allPassed) {
      expect(report.summary).toMatch(/passed/i)
    } else {
      expect(report.summary).toMatch(/failed/i)
    }
  })

  it('accepts custom port option', async () => {
    const report = await runPreflight({ port: 59125, skipNetwork: true })
    const portCheck = findCheck(report, 'port-available')
    expect(portCheck).toBeDefined()
    expect(portCheck!.details?.port).toBe(59125)
  })
})

// ── CLI Format Tests ──

describe('Preflight: formatPreflightReport', () => {

  it('formats passing report', async () => {
    const report = await runPreflight({ skipNetwork: true })
    const output = formatPreflightReport(report)
    expect(output).toContain('Preflight Checks')
    expect(output).toContain('Node.js')
    if (report.allPassed) {
      expect(output).toContain('✅')
    }
  })

  it('formats failing report with recovery steps', async () => {
    const report = await runPreflight({
      cloudUrl: 'https://definitely-not-real-12345.invalid',
    })
    const output = formatPreflightReport(report)
    expect(output).toContain('Preflight Checks')

    if (!report.allPassed) {
      expect(output).toContain('❌')
      expect(output).toContain('Recovery')
    }
  })
})

// ── Onboarding Drop-off Instrumentation ──

describe('Preflight: onboarding drop-off events', () => {

  beforeEach(() => {
    resetActivationFunnel()
  })

  it('emits host_preflight_passed on all-pass with userId', async () => {
    const report = await runPreflight({
      skipNetwork: true,
      userId: 'test-user-pass-1',
    })

    if (report.allPassed) {
      // Give async emit a moment to settle
      await new Promise(r => setTimeout(r, 100))
      const state = getUserFunnelState('test-user-pass-1')
      expect(state.events.host_preflight_passed).toBeTypeOf('number')
      expect(state.events.host_preflight_failed).toBeNull()
    }
  })

  it('emits host_preflight_failed when a check fails', async () => {
    const report = await runPreflight({
      cloudUrl: 'https://definitely-not-real-12345.invalid',
      userId: 'test-user-fail-1',
    })

    if (!report.allPassed) {
      await new Promise(r => setTimeout(r, 100))
      const state = getUserFunnelState('test-user-fail-1')
      expect(state.events.host_preflight_failed).toBeTypeOf('number')
      expect(state.events.host_preflight_passed).toBeNull()
    }
  })

  it('uses host-hostname fallback when no userId provided', async () => {
    const { hostname } = await import('node:os')
    const report = await runPreflight({ skipNetwork: true })
    expect(report).toBeDefined()
    await new Promise(r => setTimeout(r, 100))
    const state = getUserFunnelState(`host-${hostname()}`)
    if (report.allPassed) {
      expect(state.events.host_preflight_passed).toBeTypeOf('number')
    }
  })

  it('drop-off event is idempotent per user', async () => {
    await runPreflight({ skipNetwork: true, userId: 'test-user-idem-1' })
    await new Promise(r => setTimeout(r, 100))
    const state1 = getUserFunnelState('test-user-idem-1')
    const ts1 = state1.events.host_preflight_passed

    await runPreflight({ skipNetwork: true, userId: 'test-user-idem-1' })
    await new Promise(r => setTimeout(r, 100))
    const state2 = getUserFunnelState('test-user-idem-1')
    const ts2 = state2.events.host_preflight_passed

    // Timestamp should not change (idempotent)
    expect(ts1).toBe(ts2)
  })
})
