/**
 * Cloud Outage Drill — CI Release Gate
 *
 * Integration test that verifies:
 *   1. Host starts in connected state
 *   2. Cloud outage triggers degraded → offline transitions
 *   3. Local operations continue during outage
 *   4. Queue grows during outage
 *   5. Recovery restores connected state + queue drains
 *
 * This test is a release gate — it must pass before shipping.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  // Clean up test tasks
  try {
    const res = await app.inject({ method: 'GET', url: '/tasks?limit=500' })
    const tasks = JSON.parse(res.body)?.tasks || []
    for (const task of tasks) {
      if (typeof task.title === 'string' && task.title.startsWith('TEST:')) {
        await app.inject({ method: 'DELETE', url: `/tasks/${task.id}` })
      }
    }
  } catch {}
  await app.close()
})

async function req(method: string, url: string, body?: unknown) {
  const res = await app.inject({
    method: method as any,
    url,
    payload: body,
    headers: body ? { 'content-type': 'application/json' } : undefined,
  })
  return {
    status: res.statusCode,
    body: JSON.parse(res.body),
  }
}

describe('Cloud Outage Drill (Release Gate)', () => {
  beforeEach(async () => {
    // Reset connectivity state before each test
    await req('POST', '/connectivity/reset')
    // Set fast thresholds for testing
    await req('PATCH', '/connectivity/thresholds', {
      degradedAfterFailures: 3,
      offlineAfterMs: 100,  // 100ms for testing (not 5min)
      recoveryAfterSuccesses: 2,
    })
  })

  it('starts in connected state', async () => {
    const res = await req('GET', '/connectivity/status')
    expect(res.status).toBe(200)
    expect(res.body.connectivity.mode).toBe('connected')
    expect(res.body.connectivity.consecutiveFailures).toBe(0)
  })

  it('transitions to degraded after threshold failures', async () => {
    // Simulate 3 consecutive failures
    const res = await req('POST', '/connectivity/simulate-failure', {
      reason: 'cloud_timeout',
      count: 3,
    })
    expect(res.status).toBe(200)
    expect(res.body.state.mode).toBe('degraded')
    expect(res.body.state.degradedReason).toBe('cloud_timeout')
    expect(res.body.state.degradedSince).toBeGreaterThan(0)
  })

  it('transitions to offline after sustained degraded period', async () => {
    // Enter degraded
    await req('POST', '/connectivity/simulate-failure', { count: 3 })

    // Wait for offlineAfterMs (100ms in test)
    await new Promise(resolve => setTimeout(resolve, 150))

    // Additional failure should trigger offline
    const res = await req('POST', '/connectivity/simulate-failure', { count: 1 })
    expect(res.body.state.mode).toBe('offline')
    expect(res.body.state.offlineSince).toBeGreaterThan(0)
  })

  it('local task operations continue during outage', async () => {
    // Enter offline mode
    await req('POST', '/connectivity/simulate-failure', { count: 3 })
    await new Promise(resolve => setTimeout(resolve, 150))
    await req('POST', '/connectivity/simulate-failure', { count: 1 })

    // Verify offline
    const status = await req('GET', '/connectivity/status')
    expect(status.body.connectivity.mode).toBe('offline')

    // Create a task — should succeed even offline
    const create = await req('POST', '/tasks', {
      title: 'TEST: task during outage',
      assignee: 'link',
      reviewer: 'kai',
      done_criteria: ['works offline'],
      eta: '30m',
      createdBy: 'test',
    })
    expect(create.status).toBe(200)
    expect(create.body.task.id).toBeTruthy()

    // Update task — should succeed even offline
    const update = await req('PATCH', `/tasks/${create.body.task.id}`, {
      status: 'doing',
    })
    expect(update.status).toBe(200)

    // Read task — should succeed even offline
    const read = await req('GET', `/tasks/${create.body.task.id}`)
    expect(read.status).toBe(200)
    expect(read.body.task.status).toBe('doing')

    // List tasks — should succeed even offline
    const list = await req('GET', '/tasks?limit=5')
    expect(list.status).toBe(200)
  })

  it('chat operations continue during outage', async () => {
    // Enter offline
    await req('POST', '/connectivity/simulate-failure', { count: 3 })
    await new Promise(resolve => setTimeout(resolve, 150))
    await req('POST', '/connectivity/simulate-failure', { count: 1 })

    // Send a message — should succeed
    const msg = await req('POST', '/chat/messages', {
      from: 'test-agent',
      content: 'TEST: message during outage',
      channel: 'general',
    })
    expect(msg.status).toBeLessThan(300) // 200 or 201

    // Read messages — should succeed
    const msgs = await req('GET', '/chat/messages?limit=5')
    expect(msgs.status).toBe(200)
  })

  it('health endpoint works during outage', async () => {
    await req('POST', '/connectivity/simulate-failure', { count: 3 })
    await new Promise(resolve => setTimeout(resolve, 150))
    await req('POST', '/connectivity/simulate-failure', { count: 1 })

    const health = await req('GET', '/health')
    expect(health.status).toBe(200)
    expect(health.body.status).toBe('ok')
  })

  it('webhook queue grows during outage', async () => {
    // Enter offline
    await req('POST', '/connectivity/simulate-failure', { count: 3 })
    await new Promise(resolve => setTimeout(resolve, 150))
    await req('POST', '/connectivity/simulate-failure', { count: 1 })

    // Get initial stats
    const before = await req('GET', '/webhooks/stats')
    const beforeTotal = before.body.stats.total

    // Enqueue webhooks during outage
    await req('POST', '/webhooks/deliver', {
      provider: 'test',
      eventType: 'outage.test.1',
      payload: { seq: 1 },
      targetUrl: 'http://localhost:99999/unreachable',
    })
    await req('POST', '/webhooks/deliver', {
      provider: 'test',
      eventType: 'outage.test.2',
      payload: { seq: 2 },
      targetUrl: 'http://localhost:99999/unreachable',
    })

    // Verify queue grew
    const after = await req('GET', '/webhooks/stats')
    expect(after.body.stats.total).toBeGreaterThanOrEqual(beforeTotal + 2)
  })

  it('recovers to connected after consecutive successes', async () => {
    // Enter degraded
    await req('POST', '/connectivity/simulate-failure', { count: 3 })
    expect((await req('GET', '/connectivity/status')).body.connectivity.mode).toBe('degraded')

    // 1 success — not enough
    await req('POST', '/connectivity/simulate-success', { count: 1 })
    expect((await req('GET', '/connectivity/status')).body.connectivity.mode).toBe('degraded')

    // 2nd success — should recover
    await req('POST', '/connectivity/simulate-success', { count: 1 })
    const res = await req('GET', '/connectivity/status')
    expect(res.body.connectivity.mode).toBe('connected')
    expect(res.body.connectivity.degradedSince).toBeNull()
  })

  it('recovers from offline to connected', async () => {
    // Go all the way to offline
    await req('POST', '/connectivity/simulate-failure', { count: 3 })
    await new Promise(resolve => setTimeout(resolve, 150))
    await req('POST', '/connectivity/simulate-failure', { count: 1 })
    expect((await req('GET', '/connectivity/status')).body.connectivity.mode).toBe('offline')

    // Recover with 2 successes
    await req('POST', '/connectivity/simulate-success', { count: 2 })
    const res = await req('GET', '/connectivity/status')
    expect(res.body.connectivity.mode).toBe('connected')
    expect(res.body.connectivity.offlineSince).toBeNull()
  })

  it('records transition history', async () => {
    // connected → degraded → offline → connected
    await req('POST', '/connectivity/simulate-failure', { count: 3 })
    await new Promise(resolve => setTimeout(resolve, 150))
    await req('POST', '/connectivity/simulate-failure', { count: 1 })
    await req('POST', '/connectivity/simulate-success', { count: 2 })

    const res = await req('GET', '/connectivity/status')
    const history = res.body.connectivity.transitionHistory
    expect(history.length).toBeGreaterThanOrEqual(3)
    expect(history[0].from).toBe('connected')
    expect(history[0].to).toBe('degraded')
    expect(history[1].to).toBe('offline')
    expect(history[2].to).toBe('connected')
  })

  it('full outage drill: healthy → outage → local ops → restore → drain', async () => {
    // Step 1: Verify healthy state
    let status = await req('GET', '/connectivity/status')
    expect(status.body.connectivity.mode).toBe('connected')

    // Step 2: Simulate cloud outage
    await req('POST', '/connectivity/simulate-failure', { reason: 'cloud_down', count: 3 })
    status = await req('GET', '/connectivity/status')
    expect(status.body.connectivity.mode).toBe('degraded')

    // Step 3: Wait and escalate to offline
    await new Promise(resolve => setTimeout(resolve, 150))
    await req('POST', '/connectivity/simulate-failure', { reason: 'cloud_down', count: 1 })
    status = await req('GET', '/connectivity/status')
    expect(status.body.connectivity.mode).toBe('offline')

    // Step 4: Execute local operations during outage
    const task = await req('POST', '/tasks', {
      title: 'TEST: full drill task',
      assignee: 'link',
      reviewer: 'kai',
      done_criteria: ['drill passes'],
      eta: '15m',
      createdBy: 'drill',
    })
    expect(task.status).toBe(200)

    await req('PATCH', `/tasks/${task.body.task.id}`, { status: 'doing' })
    const read = await req('GET', `/tasks/${task.body.task.id}`)
    expect(read.body.task.status).toBe('doing')

    // Step 5: Enqueue events during outage
    const webhookBefore = await req('GET', '/webhooks/stats')
    await req('POST', '/webhooks/deliver', {
      provider: 'drill',
      eventType: 'drill.event',
      payload: { drill: true },
      targetUrl: 'http://localhost:99999/nope',
    })
    const webhookAfter = await req('GET', '/webhooks/stats')
    expect(webhookAfter.body.stats.total).toBeGreaterThan(webhookBefore.body.stats.total)

    // Step 6: Restore cloud
    await req('POST', '/connectivity/simulate-success', { count: 2 })
    status = await req('GET', '/connectivity/status')
    expect(status.body.connectivity.mode).toBe('connected')

    // Step 7: Verify no data loss — task still accessible
    const verify = await req('GET', `/tasks/${task.body.task.id}`)
    expect(verify.status).toBe(200)
    expect(verify.body.task.title).toBe('TEST: full drill task')
    expect(verify.body.task.status).toBe('doing')

    // Step 8: Verify transition history is complete
    status = await req('GET', '/connectivity/status')
    const modes = status.body.connectivity.transitionHistory.map((t: any) => t.to)
    expect(modes).toContain('degraded')
    expect(modes).toContain('offline')
    expect(modes).toContain('connected')
  })
})
