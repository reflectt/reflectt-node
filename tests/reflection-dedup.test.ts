import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

const VALID_REFLECTION = {
  author: 'dedup-test-agent',
  role_type: 'agent',
  confidence: 7,
  pain: 'Test pain for dedup verification',
  impact: 'Test impact',
  evidence: ['evidence item 1', 'evidence item 2'],
  went_well: 'Test went well',
  suspected_why: 'Test suspected why',
  proposed_fix: 'Test proposed fix',
}

describe('Reflection dedup', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await createServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('accepts the first reflection', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/reflections',
      payload: VALID_REFLECTION,
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.reflection.id).toBeTruthy()
  })

  it('rejects identical reflection from same author within dedup window', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/reflections',
      payload: VALID_REFLECTION,
    })
    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
    expect(body.code).toBe('DUPLICATE_REFLECTION')
    expect(body.dedup_hash).toBeTruthy()
    expect(body.hint).toContain('dedup-test-agent')
  })

  it('accepts same content from a different author', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/reflections',
      payload: { ...VALID_REFLECTION, author: 'dedup-test-agent-2' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('accepts different content from same author', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/reflections',
      payload: { ...VALID_REFLECTION, pain: 'Completely different pain point' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('dedup is case-insensitive and whitespace-normalized', async () => {
    // First submission with altered case/whitespace
    const res1 = await app.inject({
      method: 'POST',
      url: '/reflections',
      payload: { ...VALID_REFLECTION, author: 'case-test', pain: '  Case Test Pain  ' },
    })
    expect(res1.statusCode).toBe(201)

    // Same content with different casing
    const res2 = await app.inject({
      method: 'POST',
      url: '/reflections',
      payload: { ...VALID_REFLECTION, author: 'case-test', pain: 'case test pain' },
    })
    expect(res2.statusCode).toBe(409)
  })
})
