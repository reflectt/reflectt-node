import { describe, it } from 'node:test'
import { strict as should } from 'node:assert'

const NODE_URL = 'http://127.0.0.1:4445'

describe('GET /health', async () => {
  it('returns 200 with status ok', async () => {
    const res = await fetch(`${NODE_URL}/health`)
    should.equal(res.status, 200)
    const body = await res.json() as any
    should.equal(body.status, 'ok')
    should.ok(body.version)
    should.ok(body.uptime_seconds >= 0)
  })
})

describe('GET /presence', async () => {
  it('returns agent presence list', async () => {
    const res = await fetch(`${NODE_URL}/presence`)
    should.equal(res.status, 200)
    const body = await res.json() as any
    should.ok(body.presences)
    should.ok(Array.isArray(body.presences))
  })
})

describe('GET /canvas/state', async () => {
  it('returns canvas state with agents', async () => {
    const res = await fetch(`${NODE_URL}/canvas/state`)
    should.equal(res.status, 200)
    const body = await res.json() as any
    should.ok(body.agents)
    should.equal(typeof body.agents, 'object')
  })
})

describe('GET /tasks', async () => {
  it('returns tasks list', async () => {
    const res = await fetch(`${NODE_URL}/tasks`)
    should.equal(res.status, 200)
    const body = await res.json() as any
    should.ok(body.tasks)
    should.ok(Array.isArray(body.tasks))
  })

  it('filter by status=doing', async () => {
    const res = await fetch(`${NODE_URL}/tasks?status=doing`)
    should.equal(res.status, 200)
    const body = await res.json() as any
    should.ok(Array.isArray(body.tasks))
    for (const task of body.tasks) {
      should.equal(task.status, 'doing')
    }
  })
})

describe('POST /canvas/push', async () => {
  it('accepts thought type with agentId and text', async () => {
    const res = await fetch(`${NODE_URL}/canvas/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'thought', agentId: 'kai', text: 'e2e test', ttl: 5000 }),
    })
    should.equal(res.status, 200)
    const body = await res.json() as any
    should.equal(body.success, true)
  })

  it('accepts canvas_spark type', async () => {
    const res = await fetch(`${NODE_URL}/canvas/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'canvas_spark', kind: 'utterance', agentId: 'kai', text: 'spark test', ttl: 5000 }),
    })
    const body = await res.json() as any
    should.ok(body.success === true || res.status === 200)
  })

  it('rejects missing type', async () => {
    const res = await fetch(`${NODE_URL}/canvas/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'kai' }),
    })
    should.notEqual(res.status, 200)
  })
})

describe('POST /chat/messages', async () => {
  it('posts message to general channel', async () => {
    const res = await fetch(`${NODE_URL}/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'kai', content: 'e2e test message', channel: 'general' }),
    })
    const body = await res.json() as any
    should.equal(body.success, true)
  })
})

describe('GET /chat/messages', async () => {
  it('returns recent messages', async () => {
    const res = await fetch(`${NODE_URL}/chat/messages?limit=5`)
    should.equal(res.status, 200)
    const body = await res.json() as any
    should.ok(body.messages)
    should.ok(Array.isArray(body.messages))
  })
})
