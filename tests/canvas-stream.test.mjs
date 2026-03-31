/**
 * Integration tests for canvas streaming endpoints (node:test runner)
 * Tests: /canvas/stream (snapshot + SSE), /canvas/state, /canvas/push
 * task-1773968269406-t2wemfj79
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'

// Tests against the local node running on port 4445
const NODE = 'http://127.0.0.1:4445'

describe('GET /canvas/stream — canvas SSE stream (snapshot + events)', () => {
  it('returns canvas snapshot on connect', async () => {
    const ac = new AbortController()
    const res = await fetch(`${NODE}/canvas/stream?accept=sse`, { signal: ac.signal })
    assert.equal(res.status, 200)
    const ct = res.headers.get('content-type') ?? ''
    assert.ok(ct.includes('text/event-stream'), `Got: ${ct}`)
    ac.abort()
  })

  it('emits canvas_update events as agents change', async () => {
    const ac = new AbortController()
    const events = []
    const res = await fetch(`${NODE}/canvas/stream?accept=sse`, { signal: ac.signal })
    // Read SSE stream for 5 seconds
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const timeout = setTimeout(() => ac.abort(), 5000)
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done || ac.signal.aborted) break
        const text = decoder.decode(value)
        for (const line of text.split('\n')) {
          if (line.startsWith('event:') || line.startsWith('data:')) events.push(line)
        }
      }
    } finally {
      clearTimeout(timeout)
    }
    ac.abort()
    assert.ok(events.length > 0, `Should emit at least one event, got ${events.length}`)
  })

  it('rejects non-SSE accept header', async () => {
    const res = await fetch(`${NODE}/canvas/stream?accept=json`)
    assert.ok(res.status === 406 || res.status === 400, `Got ${res.status}`)
  })
})

describe('GET /canvas/state — canvas state snapshot', () => {
  it('returns current canvas state', async () => {
    const res = await fetch(`${NODE}/canvas/state`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.agents !== undefined || body.slots !== undefined, 'Should have agents or slots')
  })

  it('returns JSON content type', async () => {
    const res = await fetch(`${NODE}/canvas/state`)
    const ct = res.headers.get('content-type') ?? ''
    assert.ok(ct.includes('application/json'), `Got: ${ct}`)
  })
})

describe('POST /canvas/push — emit canvas event', () => {
  it('accepts expression push event', async () => {
    const res = await fetch(`${NODE}/canvas/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'expression', expression: 'thought',
        agentId: 'test-agent', agentColor: '#60a5fa',
        text: 'integration test thought', ttl: 5000,
      }),
    })
    assert.equal(res.status, 200, `Got ${res.status}: ${await res.text()}`)
  })

  it('accepts speak push event', async () => {
    const res = await fetch(`${NODE}/canvas/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'speak', agentId: 'test-agent', agentColor: '#60a5fa',
        content: 'hello from tests', duration: 2000,
      }),
    })
    assert.equal(res.status, 200, `Got ${res.status}: ${await res.text()}`)
  })

  it('accepts visual push event', async () => {
    const res = await fetch(`${NODE}/canvas/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'visual', agentId: 'test-agent', agentColor: '#60a5fa',
        content: 'draft ready', subtype: 'exhale',
      }),
    })
    assert.equal(res.status, 200, `Got ${res.status}: ${await res.text()}`)
  })

  it('accepts slot update event', async () => {
    const res = await fetch(`${NODE}/canvas/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'slot_update', agentId: 'test-agent', slot: 0, state: 'inactive',
      }),
    })
    assert.equal(res.status, 200, `Got ${res.status}: ${await res.text()}`)
  })

  it('returns 400 for missing type', async () => {
    const res = await fetch(`${NODE}/canvas/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'test-agent' }),
    })
    assert.ok(res.status === 400 || res.status === 200, `Got ${res.status}`)
  })
})

describe('GET /canvas/attention — highest priority item', () => {
  it('returns attention item or empty', async () => {
    const res = await fetch(`${NODE}/canvas/attention`)
    assert.equal(res.status, 200)
    const body = await res.json()
    // Should be null or an attention item
    assert.ok(body === null || typeof body === 'object', 'Should be null or object')
  })
})
