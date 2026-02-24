import { describe, expect, it } from 'vitest'
import { runTeamDoctor } from '../src/team-doctor.js'

describe('team-doctor', () => {
  it('returns a valid report structure', () => {
    const report = runTeamDoctor()

    expect(report).toHaveProperty('timestamp')
    expect(report).toHaveProperty('overall')
    expect(report).toHaveProperty('checks')
    expect(Array.isArray(report.checks)).toBe(true)
    expect(report.checks.length).toBeGreaterThanOrEqual(4)

    for (const check of report.checks) {
      expect(check).toHaveProperty('name')
      expect(check).toHaveProperty('status')
      expect(check).toHaveProperty('message')
      expect(['pass', 'fail', 'warn']).toContain(check.status)
    }
  })

  it('node_running check always passes', () => {
    const report = runTeamDoctor()
    const nodeCheck = report.checks.find(c => c.name === 'node_running')
    expect(nodeCheck?.status).toBe('pass')
  })

  it('database check passes (SQLite is available in tests)', () => {
    const report = runTeamDoctor()
    const dbCheck = report.checks.find(c => c.name === 'database')
    expect(dbCheck?.status).toBe('pass')
  })

  it('overall is fail if any check fails', () => {
    // In test env, gateway URL is likely not set → fail
    const report = runTeamDoctor()
    const gatewayCheck = report.checks.find(c => c.name === 'gateway')

    if (gatewayCheck?.status === 'fail') {
      expect(report.overall).toBe('fail')
      expect(report.nextAction).toBeTruthy()
    }
  })

  it('provides fix instructions for failing checks', () => {
    const report = runTeamDoctor()
    const failingChecks = report.checks.filter(c => c.status === 'fail')

    for (const check of failingChecks) {
      expect(check.fix).toBeTruthy()
    }
  })
})
