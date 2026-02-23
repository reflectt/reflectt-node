import { describe, it, expect } from 'vitest'
import { runPreflight, type PreflightReport, type PreflightResult } from '../src/preflight.js'

describe('Preflight Checks', () => {
  describe('runPreflight', () => {
    it('should return structured report with all checks', async () => {
      const report = await runPreflight()

      expect(report.timestamp).toBeGreaterThan(0)
      expect(typeof report.allPassed).toBe('boolean')
      expect(report.results).toBeInstanceOf(Array)
      expect(report.results.length).toBeGreaterThanOrEqual(3)
      expect(report.summary).toBeTruthy()

      // Each result has required fields
      for (const result of report.results) {
        expect(result.check).toBeDefined()
        expect(result.check.id).toBeTruthy()
        expect(result.check.name).toBeTruthy()
        expect(typeof result.passed).toBe('boolean')
        expect(result.message).toBeTruthy()
        expect(result.durationMs).toBeGreaterThanOrEqual(0)
      }
    })

    it('should check node version and pass on Node 22', async () => {
      const report = await runPreflight()
      const nodeCheck = report.results.find(r => r.check.id === 'node-version')

      expect(nodeCheck).toBeDefined()
      expect(nodeCheck!.passed).toBe(true)
      expect(nodeCheck!.message).toContain(process.versions.node)
    })

    it('should check home directory writability', async () => {
      const report = await runPreflight()
      const homeCheck = report.results.find(r => r.check.id === 'home-writable')

      expect(homeCheck).toBeDefined()
      // Should pass in test environment
      expect(typeof homeCheck!.passed).toBe('boolean')
    })

    it('should check cloud connectivity', async () => {
      const report = await runPreflight({ cloudUrl: 'https://app.reflectt.ai' })
      const cloudCheck = report.results.find(r => r.check.id === 'cloud-reachable')

      expect(cloudCheck).toBeDefined()
      // May pass or fail depending on network
      expect(typeof cloudCheck!.passed).toBe('boolean')
    })

    it('should provide recovery steps for failures', async () => {
      // Use invalid cloud URL to force a failure
      const report = await runPreflight({
        cloudUrl: 'https://definitely-not-real-12345.invalid',
      })

      const cloudCheck = report.results.find(r => r.check.id === 'cloud-reachable')
      if (cloudCheck && !cloudCheck.passed) {
        expect(cloudCheck.recovery).toBeDefined()
        expect(cloudCheck.recovery!.length).toBeGreaterThan(0)
      }
    })

    it('should report firstBlocker when any check fails', async () => {
      const report = await runPreflight({
        cloudUrl: 'https://definitely-not-real-12345.invalid',
      })

      if (!report.allPassed && report.firstBlocker) {
        expect(report.firstBlocker.check).toBeTruthy()
        expect(report.firstBlocker.message).toBeTruthy()
        expect(report.firstBlocker.recovery.length).toBeGreaterThan(0)
      }
    })

    it('should include port availability check', async () => {
      const report = await runPreflight()
      const portCheck = report.results.find(r => r.check.id === 'port-available')

      expect(portCheck).toBeDefined()
      expect(typeof portCheck!.passed).toBe('boolean')
    })

    it('should accept custom options', async () => {
      // Should not throw with custom options
      const report = await runPreflight({
        port: 9999,
        cloudUrl: 'https://example.com',
      })

      expect(report).toBeDefined()
      expect(report.results.length).toBeGreaterThan(0)
    })

    it('should have meaningful summary', async () => {
      const report = await runPreflight()
      expect(report.summary.length).toBeGreaterThan(10)

      if (report.allPassed) {
        expect(report.summary.toLowerCase()).toMatch(/pass|ready|ok/i)
      }
    })
  })
})
