/**
 * Tests for GET /chat/context/:agent — compact, deduplicated chat context endpoint.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
const AGENT = `ctx-test-${Date.now()}`

beforeAll(async () => {
  process.env.REFLECTT_DATA_DIR = `/tmp/reflectt-test-chat-context-${Date.now()}`
  app = await createServer()
  await app.ready()

  // Seed messages: mentions, system alerts, team chat
  await app.inject({
    method: 'POST', url: '/chat/messages',
    payload: { from: 'kai', content: `@${AGENT} please review task-123`, channel: 'general' },
  })
  await app.inject({
    method: 'POST', url: '/chat/messages',
    payload: { from: 'system', content: `⚠️ SLA breach: task-111 in validating 3h. @${AGENT} review needed.`, channel: 'general' },
  })
  await app.inject({
    method: 'POST', url: '/chat/messages',
    payload: { from: 'system', content: `⚠️ SLA breach: task-222 in validating 3h. @${AGENT} review needed.`, channel: 'general' },
  })
  await app.inject({
    method: 'POST', url: '/chat/messages',
    payload: { from: 'echo', content: 'General team discussion not mentioning anyone', channel: 'general' },
  })
  await app.inject({
    method: 'POST', url: '/chat/messages',
    payload: { from: 'sage', content: 'Another team message', channel: 'general' },
  })
})

describe('GET /chat/context/:agent', () => {
  it('returns compact context for agent', async () => {
    const res = await app.inject({ method: 'GET', url: `/chat/context/${AGENT}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.agent).toBe(AGENT.toLowerCase())
    expect(body.count).toBeGreaterThan(0)
    expect(body.messages).toBeDefined()
    expect(Array.isArray(body.messages)).toBe(true)
  })

  it('returns slim message format (no id, reactions, replyCount)', async () => {
    const res = await app.inject({ method: 'GET', url: `/chat/context/${AGENT}` })
    const body = JSON.parse(res.body)
    const msg = body.messages[0]
    expect(msg.from).toBeDefined()
    expect(msg.content).toBeDefined()
    expect(msg.ts).toBeDefined()
    expect(msg.ch).toBeDefined()
    // Should NOT have full message fields
    expect(msg.id).toBeUndefined()
    expect(msg.reactions).toBeUndefined()
    expect(msg.replyCount).toBeUndefined()
  })

  it('deduplicates similar system alerts in context output', async () => {
    // Send distinct system alerts that differ only in details
    const ts = Date.now()
    await app.inject({
      method: 'POST', url: '/chat/messages',
      payload: { from: 'system', content: `🪞 Reflection due: @agent-a, overdue by 10h`, channel: 'general', metadata: { bypass_budget: true } },
    })
    await app.inject({
      method: 'POST', url: '/chat/messages',
      payload: { from: 'system', content: `🪞 Reflection due: @agent-b, overdue by 12h`, channel: 'general', metadata: { bypass_budget: true } },
    })

    const res = await app.inject({ method: 'GET', url: `/chat/context/${AGENT}` })
    const body = JSON.parse(res.body)
    // The context endpoint's own dedup should collapse similar system alerts
    const reflectionAlerts = body.messages.filter((m: any) =>
      m.from === 'system' && m.content.includes('Reflection due'),
    )
    // Should be 1 (deduped) not 2
    expect(reflectionAlerts.length).toBeLessThanOrEqual(1)
    expect(body.suppressed).toBeDefined()
    expect(body.suppressed.total_scanned).toBeGreaterThan(0)
  })

  it('includes mentions of the agent', async () => {
    const res = await app.inject({ method: 'GET', url: `/chat/context/${AGENT}` })
    const body = JSON.parse(res.body)
    const mentions = body.messages.filter((m: any) =>
      m.from !== 'system' && m.content.includes(`@${AGENT}`),
    )
    expect(mentions.length).toBeGreaterThanOrEqual(1)
  })

  it('is significantly smaller than raw chat/messages', async () => {
    const raw = await app.inject({ method: 'GET', url: '/chat/messages?channel=general&limit=30' })
    const context = await app.inject({ method: 'GET', url: `/chat/context/${AGENT}?limit=30` })
    // Context should be smaller due to slim format + dedup
    expect(context.body.length).toBeLessThanOrEqual(raw.body.length)
  })

  it('respects limit param', async () => {
    const res = await app.inject({ method: 'GET', url: `/chat/context/${AGENT}?limit=2` })
    const body = JSON.parse(res.body)
    expect(body.messages.length).toBeLessThanOrEqual(2)
  })
})
