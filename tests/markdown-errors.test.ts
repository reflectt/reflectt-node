import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

describe('Markdown error responses', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await createServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('404 — unmatched routes', () => {
    it('returns markdown by default for unknown routes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/this-route-does-not-exist',
      })
      expect(res.statusCode).toBe(404)
      expect(res.headers['content-type']).toContain('text/markdown')
      expect(res.body).toContain('# 404')
      expect(res.body).toContain('GET /capabilities')
      expect(res.body).toContain('/this-route-does-not-exist')
    })

    it('returns JSON when Accept: application/json is set', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/nonexistent',
        headers: { accept: 'application/json' },
      })
      expect(res.statusCode).toBe(404)
      expect(res.headers['content-type']).toContain('application/json')
      const body = JSON.parse(res.body)
      expect(body.success).toBe(false)
      expect(body.code).toBe('NOT_FOUND')
      expect(body.hint).toContain('/capabilities')
      expect(body.requested).toBe('GET /nonexistent')
    })

    it('includes bootstrap and heartbeat hints for new agents', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/unknown-endpoint',
      })
      expect(res.body).toContain('/bootstrap/heartbeat/:agent')
      expect(res.body).toContain('/heartbeat/:agent')
      expect(res.body).toContain('compact=true')
    })

    it('includes the requested method and URL in markdown', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/bad/path',
      })
      expect(res.statusCode).toBe(404)
      expect(res.body).toContain('POST /bad/path')
    })

    it('includes common endpoint groups in markdown', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/nope',
      })
      expect(res.body).toContain('**Tasks:**')
      expect(res.body).toContain('**Chat:**')
      expect(res.body).toContain('**Inbox:**')
      expect(res.body).toContain('**Insights:**')
    })
  })

  describe('500 — error handler', () => {
    // We test the error handler via a separate app instance with a throwing route
    // registered before ready()
    it('returns markdown diagnostics by default for 500s', async () => {
      const testApp = await createServer()
      // Register throwing route BEFORE ready()
      testApp.get('/test-500-throw', async () => {
        throw new Error('Intentional test error')
      })
      await testApp.ready()

      const res = await testApp.inject({
        method: 'GET',
        url: '/test-500-throw',
      })
      expect(res.statusCode).toBe(500)
      expect(res.headers['content-type']).toContain('text/markdown')
      expect(res.body).toContain('# 500')
      expect(res.body).toContain('GET /health')
      expect(res.body).toContain('GET /logs')

      await testApp.close()
    })

    it('returns JSON 500 when Accept: application/json', async () => {
      const testApp = await createServer()
      testApp.get('/test-500-json', async () => {
        throw new Error('Intentional test error')
      })
      await testApp.ready()

      const res = await testApp.inject({
        method: 'GET',
        url: '/test-500-json',
        headers: { accept: 'application/json' },
      })
      expect(res.statusCode).toBe(500)
      const body = JSON.parse(res.body)
      expect(body.success).toBe(false)
      expect(body.code).toBe('INTERNAL_ERROR')
      expect(body.hint).toContain('/health')

      await testApp.close()
    })
  })
})
