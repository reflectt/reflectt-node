// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll } from 'vitest'
import Fastify from 'fastify'

describe('Execution Sweeper endpoints', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    // Import and build the app
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  describe('GET /execution-health', () => {
    it('returns sweeper status and current violations', async () => {
      const res = await app.inject({ method: 'GET', url: '/execution-health' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body).toHaveProperty('sweeper')
      expect(body.sweeper).toHaveProperty('running')
      expect(body.sweeper).toHaveProperty('lastSweepAt')
      expect(body).toHaveProperty('current')
      expect(body.current).toHaveProperty('validatingCount')
      expect(body.current).toHaveProperty('violations')
      expect(body.current).toHaveProperty('tasksScanned')
      expect(typeof body.current.validatingCount).toBe('number')
      expect(Array.isArray(body.current.violations)).toBe(true)
    })
  })

  describe('GET /drift-report', () => {
    it('returns comprehensive drift report', async () => {
      const res = await app.inject({ method: 'GET', url: '/drift-report' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)

      // Core report structure
      expect(body).toHaveProperty('timestamp')
      expect(body).toHaveProperty('validating')
      expect(body).toHaveProperty('orphanPRs')
      expect(body).toHaveProperty('summary')
      expect(Array.isArray(body.validating)).toBe(true)
      expect(Array.isArray(body.orphanPRs)).toBe(true)

      // Summary fields
      expect(body.summary).toHaveProperty('totalValidating')
      expect(body.summary).toHaveProperty('staleValidating')
      expect(body.summary).toHaveProperty('orphanPRCount')
      expect(body.summary).toHaveProperty('prDriftCount')
      expect(body.summary).toHaveProperty('cleanCount')

      // Sweeper status included
      expect(body).toHaveProperty('sweeper')
      expect(body.sweeper).toHaveProperty('running')

      // Dry run log included
      expect(body).toHaveProperty('dryRunLog')
      expect(Array.isArray(body.dryRunLog)).toBe(true)
    })

    it('validating entries have expected fields', async () => {
      const res = await app.inject({ method: 'GET', url: '/drift-report' })
      const body = JSON.parse(res.body)

      for (const entry of body.validating) {
        expect(entry).toHaveProperty('taskId')
        expect(entry).toHaveProperty('title')
        expect(entry).toHaveProperty('status', 'validating')
        expect(entry).toHaveProperty('age_minutes')
        expect(entry).toHaveProperty('issue')
        expect(entry).toHaveProperty('detail')
        expect(['stale_validating', 'orphan_pr', 'pr_merged_not_closed', 'no_pr_linked', 'clean']).toContain(entry.issue)
      }
    })
  })

  describe('POST /pr-event', () => {
    it('rejects missing taskId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/pr-event',
        payload: { prState: 'merged' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects missing prState', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/pr-event',
        payload: { taskId: 'test-123' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('handles non-existent task gracefully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/pr-event',
        payload: { taskId: 'nonexistent-task', prState: 'merged' },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.success).toBe(true)
    })
  })
})
