// Tests for chat message deduplication improvements
import { describe, it, expect, beforeAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  process.env.REFLECTT_DATA_DIR = `/tmp/reflectt-test-dedup-${Date.now()}`
  app = await createServer()
  await app.ready()
})

async function sendMsg(from: string, content: string, channel = 'general', metadata?: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/chat/messages',
    payload: { from, content, channel, ...(metadata ? { metadata } : {}) },
  })
  const body = JSON.parse(res.body)
  return { statusCode: res.statusCode, body, id: body?.message?.id as string | undefined }
}

describe('Chat dedup suppression', () => {
  it('suppresses duplicate system messages within 30m window', async () => {
    const content = '⚠️ Ready-queue floor: @link has 0/2 unblocked todo tasks (need 2 more). @sage @pixel — please spec.'

    const first = await sendMsg('system', content)
    expect(first.statusCode).toBe(200)
    expect(first.id).toBeDefined()
    expect(first.id).not.toContain('suppressed')

    const second = await sendMsg('system', content)
    expect(second.statusCode).toBe(200)
    expect(second.id).toContain('suppressed')
  })

  it('suppresses system messages with different task IDs but same pattern', async () => {
    const ts = Date.now()
    const content1 = `⚠️ SLA breach: "Fix bug" (task-${ts}-abc) in validating 3h. @kai — review needed.`
    const content2 = `⚠️ SLA breach: "Fix bug" (task-${ts}-xyz) in validating 3h. @kai — review needed.`

    const first = await sendMsg('system', content1)
    expect(first.statusCode).toBe(200)
    expect(first.id).not.toContain('suppressed')

    const second = await sendMsg('system', content2)
    expect(second.statusCode).toBe(200)
    expect(second.id).toContain('suppressed')
  })

  it('supports explicit dedup_key in metadata', async () => {
    const key = `test-dedup-key-${Date.now()}`

    const first = await sendMsg('system', 'Alert: event A at ' + Date.now(), 'general', { dedup_key: key })
    expect(first.statusCode).toBe(200)
    expect(first.id).not.toContain('suppressed')

    // Same dedup_key, different content — should still be suppressed
    const second = await sendMsg('system', 'Alert: event B at ' + Date.now(), 'general', { dedup_key: key })
    expect(second.statusCode).toBe(200)
    expect(second.id).toContain('suppressed')
  })

  it('does not suppress messages from different channels', async () => {
    const content = 'Unique cross-channel test ' + Date.now()

    const first = await sendMsg('system', content, 'general')
    expect(first.statusCode).toBe(200)
    expect(first.id).not.toContain('suppressed')

    // Same content, different channel — should NOT be suppressed
    const second = await sendMsg('system', content, 'shipping')
    expect(second.statusCode).toBe(200)
    expect(second.id).toBeDefined()
    expect(second.id).not.toContain('suppressed')
  })
})

describe('GET /chat/suppression/stats', () => {
  it('returns suppression statistics', async () => {
    const res = await app.inject({ method: 'GET', url: '/chat/suppression/stats' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.inline_dedup).toBeDefined()
    expect(body.inline_dedup.total).toBeGreaterThanOrEqual(0)
    expect(body.inline_dedup.byCategory).toBeDefined()
    expect(body.inline_dedup.since).toBeGreaterThan(0)
    expect(typeof body.inline_dedup.activeHashes).toBe('number')
    expect(body.ledger).toBeDefined()
  })

  it('tracks suppressed count after dedup', async () => {
    // Get baseline
    const before = await app.inject({ method: 'GET', url: '/chat/suppression/stats' })
    const baselineTotal = JSON.parse(before.body).inline_dedup.total

    // Send + suppress a message
    const content = 'Stats tracking test ' + Date.now()
    await sendMsg('system', content)
    await sendMsg('system', content)

    const after = await app.inject({ method: 'GET', url: '/chat/suppression/stats' })
    const afterTotal = JSON.parse(after.body).inline_dedup.total
    expect(afterTotal).toBeGreaterThan(baselineTotal)
  })
})
