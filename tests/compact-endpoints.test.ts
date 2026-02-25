/**
 * Tests for compact mode across chat messages, insights, and loop/summary.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  process.env.REFLECTT_DATA_DIR = `/tmp/reflectt-test-compact-ep-${Date.now()}`
  app = await createServer()
  await app.ready()

  // Seed chat messages
  await app.inject({
    method: 'POST', url: '/chat/messages',
    payload: { from: 'link', content: 'Testing compact endpoints', channel: 'general' },
  })
})

describe('GET /chat/messages?compact=true', () => {
  it('returns slim messages', async () => {
    const res = await app.inject({ method: 'GET', url: '/chat/messages?channel=general&compact=true' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.messages.length).toBeGreaterThan(0)
    const msg = body.messages[0]
    expect(msg.from).toBeDefined()
    expect(msg.content).toBeDefined()
    expect(msg.ts).toBeDefined()
    expect(msg.ch).toBeDefined()
    expect(msg.id).toBeUndefined()
    expect(msg.reactions).toBeUndefined()
    expect(msg.replyCount).toBeUndefined()
  })

  it('returns full messages without compact', async () => {
    const res = await app.inject({ method: 'GET', url: '/chat/messages?channel=general' })
    const body = JSON.parse(res.body)
    const msg = body.messages[0]
    expect(msg.id).toBeDefined()
    expect(msg.timestamp).toBeDefined()
  })

  it('compact is smaller', async () => {
    const full = await app.inject({ method: 'GET', url: '/chat/messages?channel=general' })
    const compact = await app.inject({ method: 'GET', url: '/chat/messages?channel=general&compact=true' })
    expect(compact.body.length).toBeLessThan(full.body.length)
  })
})

describe('GET /loop/summary?compact=true', () => {
  it('returns slim entries without evidence_refs', async () => {
    // Seed a reflection to generate an insight
    await app.inject({
      method: 'POST', url: '/reflections',
      payload: {
        pain: 'Tests are slow',
        impact: 'high',
        evidence: ['CI takes 10 minutes'],
        went_well: 'Coverage is good',
        suspected_why: 'Too many integration tests',
        proposed_fix: 'Add unit test tier',
        confidence: 7,
        role_type: 'engineer',
        author: 'link',
      },
    })

    const res = await app.inject({ method: 'GET', url: '/loop/summary?compact=true' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    if (body.entries.length > 0) {
      const entry = body.entries[0]
      expect(entry.insight_id).toBeDefined()
      expect(entry.title).toBeDefined()
      expect(entry.score).toBeDefined()
      // Heavy fields stripped
      expect(entry.evidence_refs).toBeUndefined()
      expect(entry.authors).toBeUndefined()
      expect(entry.workflow_stage).toBeUndefined()
    }
  })

  it('full response has evidence_refs', async () => {
    const res = await app.inject({ method: 'GET', url: '/loop/summary' })
    const body = JSON.parse(res.body)
    if (body.entries.length > 0) {
      expect(body.entries[0].evidence_refs).toBeDefined()
    }
  })
})

describe('GET /insights?compact=true', () => {
  it('returns slim insights', async () => {
    const res = await app.inject({ method: 'GET', url: '/insights?compact=true' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    if (body.insights && body.insights.length > 0) {
      const insight = body.insights[0]
      expect(insight.id).toBeDefined()
      expect(insight.title).toBeDefined()
      expect(insight.score).toBeDefined()
      // Heavy fields stripped
      expect(insight.evidence_refs).toBeUndefined()
      expect(insight.reflection_ids).toBeUndefined()
      expect(insight.authors).toBeUndefined()
    }
  })
})
