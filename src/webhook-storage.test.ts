// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

interface Payload { id: string; source: string; eventType: string; agentId: string | null; body: Record<string, unknown>; processed: boolean }

class InMemoryWebhookStore {
  private payloads: Payload[] = []
  private counter = 0

  ingest(source: string, eventType: string, body: Record<string, unknown>, agentId?: string): Payload {
    const p: Payload = { id: `whk-${++this.counter}`, source, eventType, agentId: agentId ?? null, body, processed: false }
    this.payloads.push(p)
    return p
  }

  get(id: string): Payload | null { return this.payloads.find(p => p.id === id) ?? null }

  list(opts?: { source?: string; agentId?: string; unprocessedOnly?: boolean }): Payload[] {
    return this.payloads.filter(p => {
      if (opts?.source && p.source !== opts.source) return false
      if (opts?.agentId && p.agentId !== opts.agentId) return false
      if (opts?.unprocessedOnly && p.processed) return false
      return true
    })
  }

  markProcessed(id: string): boolean {
    const p = this.get(id)
    if (!p || p.processed) return false
    p.processed = true
    return true
  }

  unprocessedCount(opts?: { source?: string }): number {
    return this.list({ source: opts?.source, unprocessedOnly: true }).length
  }

  clear() { this.payloads = []; this.counter = 0 }
}

describe('webhook storage', () => {
  let store: InMemoryWebhookStore

  beforeEach(() => { store = new InMemoryWebhookStore() })

  it('ingests a payload', () => {
    const p = store.ingest('resend', 'email.received', { from: 'user@example.com', subject: 'Test' })
    assert.ok(p.id.startsWith('whk-'))
    assert.equal(p.source, 'resend')
    assert.equal(p.eventType, 'email.received')
    assert.equal(p.processed, false)
  })

  it('retrieves by id', () => {
    const p = store.ingest('resend', 'email.received', { subject: 'Hello' })
    assert.deepEqual(store.get(p.id)?.body, { subject: 'Hello' })
  })

  it('returns null for missing id', () => {
    assert.equal(store.get('nonexistent'), null)
  })

  it('lists by source', () => {
    store.ingest('resend', 'email.received', { a: 1 })
    store.ingest('twilio', 'sms.received', { b: 2 })
    store.ingest('resend', 'email.bounced', { c: 3 })
    assert.equal(store.list({ source: 'resend' }).length, 2)
    assert.equal(store.list({ source: 'twilio' }).length, 1)
  })

  it('lists by agent', () => {
    store.ingest('resend', 'email.received', {}, 'link')
    store.ingest('resend', 'email.received', {}, 'kai')
    assert.equal(store.list({ agentId: 'link' }).length, 1)
  })

  it('marks as processed', () => {
    const p = store.ingest('resend', 'email.received', {})
    assert.equal(store.markProcessed(p.id), true)
    assert.equal(store.get(p.id)?.processed, true)
    // Double-process returns false
    assert.equal(store.markProcessed(p.id), false)
  })

  it('filters unprocessed only', () => {
    const p1 = store.ingest('resend', 'email.received', {})
    store.ingest('resend', 'email.received', {})
    store.markProcessed(p1.id)
    assert.equal(store.list({ unprocessedOnly: true }).length, 1)
  })

  it('tracks unprocessed count', () => {
    store.ingest('resend', 'email.received', {})
    store.ingest('resend', 'email.received', {})
    store.ingest('twilio', 'sms.received', {})
    assert.equal(store.unprocessedCount(), 3)
    assert.equal(store.unprocessedCount({ source: 'resend' }), 2)
  })
})
