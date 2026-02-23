/**
 * Tests for service-probe: synthetic health probe + auto-restart.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  checkEndpoint,
  canRestart,
  _probeState,
  ENDPOINTS,
  DEFAULT_CONFIG,
  type ProbeConfig,
} from '../src/service-probe.js'

const testConfig: ProbeConfig = {
  ...DEFAULT_CONFIG,
  dryRun: true, // Never actually restart in tests
  timeoutMs: 2000,
  logPath: '/dev/null',
}

describe('Service probe: endpoint checks', () => {
  it('ENDPOINTS includes health and tasks-list as critical', () => {
    const critical = ENDPOINTS.filter(e => e.critical)
    expect(critical.length).toBeGreaterThanOrEqual(2)
    expect(critical.map(e => e.name)).toContain('health')
    expect(critical.map(e => e.name)).toContain('tasks-list')
  })

  it('noise-budget endpoint is non-critical', () => {
    const nb = ENDPOINTS.find(e => e.name === 'noise-budget')
    expect(nb).toBeDefined()
    expect(nb!.critical).toBe(false)
  })

  it('checkEndpoint returns ok for live health endpoint', async (ctx) => {
    // Integration test — skip if server not running
    try {
      const res = await fetch('http://127.0.0.1:4445/health', { signal: AbortSignal.timeout(2000) })
      if (!res.ok) return ctx.skip()
    } catch { return ctx.skip() }

    const healthEndpoint = ENDPOINTS.find(e => e.name === 'health')!
    const result = await checkEndpoint(testConfig, healthEndpoint)
    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBeLessThan(testConfig.timeoutMs)
  })

  it('checkEndpoint returns failure for unreachable endpoint', async () => {
    const badConfig: ProbeConfig = { ...testConfig, baseUrl: 'http://127.0.0.1:19999' }
    const result = await checkEndpoint(badConfig, ENDPOINTS[0])
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('checkEndpoint respects timeout', async () => {
    const slowConfig: ProbeConfig = { ...testConfig, baseUrl: 'http://10.255.255.1', timeoutMs: 500 }
    const start = Date.now()
    const result = await checkEndpoint(slowConfig, ENDPOINTS[0])
    const elapsed = Date.now() - start
    expect(result.ok).toBe(false)
    expect(elapsed).toBeLessThan(2000) // Should abort well before 2s
  })
})

describe('Service probe: restart guard', () => {
  beforeEach(() => {
    _probeState.consecutiveFailures = 0
    _probeState.restartTimestamps = []
    _probeState.totalRestarts = 0
  })

  it('allows restart when under limit', () => {
    const result = canRestart(testConfig)
    expect(result.allowed).toBe(true)
  })

  it('denies restart when max restarts/hour exceeded', () => {
    const now = Date.now()
    // Fill up restart timestamps
    _probeState.restartTimestamps = Array.from(
      { length: testConfig.maxRestartsPerHour },
      (_, i) => now - i * 1000
    )
    const result = canRestart(testConfig)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Max restarts')
  })

  it('prunes old timestamps (>1h)', () => {
    const now = Date.now()
    _probeState.restartTimestamps = [
      now - 7200_000, // 2h ago — should be pruned
      now - 3700_000, // 1h+ ago — should be pruned
      now - 1000,     // 1s ago — should stay
    ]
    canRestart(testConfig)
    expect(_probeState.restartTimestamps.length).toBe(1)
  })
})

describe('Service probe: validation functions', () => {
  it('health validator accepts {status: "ok"}', () => {
    const health = ENDPOINTS.find(e => e.name === 'health')!
    expect(health.validate({ status: 'ok' })).toBe(true)
    expect(health.validate({ status: 'error' })).toBe(false)
    expect(health.validate(null)).toBe(false)
  })

  it('tasks-list validator accepts {success: true} or {tasks: []}', () => {
    const tasks = ENDPOINTS.find(e => e.name === 'tasks-list')!
    expect(tasks.validate({ success: true })).toBe(true)
    expect(tasks.validate({ tasks: [] })).toBe(true)
    expect(tasks.validate({ error: 'fail' })).toBe(false)
  })

  it('noise-budget validator accepts {success: true}', () => {
    const nb = ENDPOINTS.find(e => e.name === 'noise-budget')!
    expect(nb.validate({ success: true })).toBe(true)
    expect(nb.validate({ success: false })).toBe(false)
  })
})
