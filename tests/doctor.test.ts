import { describe, it, expect } from 'vitest'
import { collectDoctorReport, formatDoctorHuman } from '../src/doctor.js'

function mkFetch(map: Record<string, { status: number; json: any }>) {
  return async (input: RequestInfo | URL) => {
    const url = String(input)
    const hit = map[url]
    if (!hit) {
      return new Response(JSON.stringify({ error: 'not found in test map' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(hit.json), {
      status: hit.status,
      headers: { 'content-type': 'application/json' },
    })
  }
}

describe('doctor report', () => {
  it('collects required sections and formats human output', async () => {
    const baseUrl = 'http://example.local:4445'
    const fetchFn = mkFetch({
      [`${baseUrl}/health`]: { status: 200, json: { status: 'ok', version: '0.1.0', commit: 'abc' } },
      [`${baseUrl}/health/system`]: { status: 200, json: { uptimeHours: 1, requestCount: 10, errorRate: 0 } },
      [`${baseUrl}/execution-health`]: { status: 200, json: { sweeper: { running: true, lastSweepAt: 123 }, current: { violations: [] } } },
      [`${baseUrl}/policy`]: { status: 200, json: { success: true, policy: { quietHours: { enabled: true, startHour: 22, endHour: 8 } } } },
      [`${baseUrl}/health/team/doctor`]: { status: 200, json: { overall: 'pass', checks: [] } },
      [`${baseUrl}/preflight`]: { status: 200, json: { ok: true, issues: [] } },
    })

    const report = await collectDoctorReport({ baseUrl, fetchFn, timeoutMs: 500 })
    expect(report.baseUrl).toBe(baseUrl)
    expect(report.overall).toBe('pass')
    expect(Object.keys(report.sections)).toEqual(['health', 'system', 'execution', 'policy', 'teamDoctor', 'preflight'])
    expect(report.sections.health.ok).toBe(true)

    const out = formatDoctorHuman(report)
    expect(out).toContain('reflectt doctor')
    expect(out).toContain('/health')
    expect(out).toContain('/health/system')
    expect(out).toContain('/execution-health')
    expect(out).toContain('/policy')
    expect(out).toContain('/health/team/doctor')
    expect(out).toContain('/preflight')
    expect(out).toContain('Copy/paste support bundle')
  })

  it('fails if any critical section is unreachable', async () => {
    const baseUrl = 'http://example.local:4445'
    const fetchFn = mkFetch({
      [`${baseUrl}/health`]: { status: 503, json: { error: 'down' } },
      [`${baseUrl}/health/system`]: { status: 200, json: {} },
      [`${baseUrl}/execution-health`]: { status: 200, json: {} },
      [`${baseUrl}/policy`]: { status: 200, json: { success: true, policy: {} } },
      [`${baseUrl}/health/team/doctor`]: { status: 200, json: { overall: 'pass', checks: [] } },
      [`${baseUrl}/preflight`]: { status: 200, json: {} },
    })

    const report = await collectDoctorReport({ baseUrl, fetchFn, timeoutMs: 500 })
    expect(report.ok).toBe(false)
    expect(report.overall).toBe('fail')
    expect(report.sections.health.ok).toBe(false)
  })

  it('treats team doctor overall=fail as FAIL even when endpoints are reachable', async () => {
    const baseUrl = 'http://example.local:4445'
    const fetchFn = mkFetch({
      [`${baseUrl}/health`]: { status: 200, json: { status: 'ok' } },
      [`${baseUrl}/health/system`]: { status: 200, json: {} },
      [`${baseUrl}/execution-health`]: { status: 200, json: { sweeper: { running: true } } },
      [`${baseUrl}/policy`]: { status: 200, json: { success: true, policy: {} } },
      [`${baseUrl}/health/team/doctor`]: { status: 200, json: { overall: 'fail', checks: [{ name: 'model_auth', status: 'fail' }] } },
      [`${baseUrl}/preflight`]: { status: 200, json: {} },
    })

    const report = await collectDoctorReport({ baseUrl, fetchFn, timeoutMs: 500 })
    expect(report.overall).toBe('fail')
    expect(report.ok).toBe(false)
  })
})
