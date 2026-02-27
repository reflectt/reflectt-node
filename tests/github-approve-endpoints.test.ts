// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  const { createServer } = await import('../src/server.js')
  app = await createServer()
  await app.ready()
})

describe('GitHub approval endpoints (guards)', () => {
  it('rejects by default when disabled', async () => {
    delete process.env.REFLECTT_ENABLE_GITHUB_APPROVAL_API

    const res = await app.inject({
      method: 'GET',
      url: '/github/whoami/kai',
    })

    expect(res.statusCode).toBe(403)
  })

  it('enforces optional admin token when configured', async () => {
    process.env.REFLECTT_ENABLE_GITHUB_APPROVAL_API = 'true'
    process.env.REFLECTT_GITHUB_APPROVAL_TOKEN = 'secret'

    const missing = await app.inject({ method: 'GET', url: '/github/whoami/kai' })
    expect(missing.statusCode).toBe(403)

    const ok = await app.inject({
      method: 'GET',
      url: '/github/whoami/kai',
      headers: { 'x-reflectt-admin-token': 'secret' },
    })

    // 404 is fine here (no token configured for actor). The point is guard passed.
    expect([200, 404, 502]).toContain(ok.statusCode)

    delete process.env.REFLECTT_GITHUB_APPROVAL_TOKEN
  })

  it('rejects non-local requests (localhost-only)', async () => {
    process.env.REFLECTT_ENABLE_GITHUB_APPROVAL_API = 'true'

    const res = await app.inject({
      method: 'GET',
      url: '/github/whoami/kai',
      remoteAddress: '10.0.0.9',
    })

    expect(res.statusCode).toBe(403)
  })
})
