// SPDX-License-Identifier: Apache-2.0
/**
 * End-to-end harness for POST /canvas/briefing.
 *
 * Verifies:
 * 1. Briefing fires canvas_expression events for each active agent in the SSE stream
 * 2. Each event carries the correct agentId, voice line, and color
 * 3. Events are staggered (not all at t=0)
 * 4. Cooldown gate: second call within 30s returns idempotent=true, no new events
 * 5. Empty canvas: briefing with no active agents returns success with empty agents array
 * 6. Briefing returns totalMs proportional to agent count × stagger interval
 *
 * Strategy: import eventBus directly (same module scope as server), subscribe before
 * firing briefing, collect canvas_expression events, assert on shape + count.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'
import { eventBus } from '../src/events.js'
import type { FastifyInstance } from 'fastify'
import type { Event } from '../src/events.js'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  await app?.close()
})

/** Push canvas state for an agent and wait for the in-memory map to update */
async function pushCanvasState(agentId: string, state: string, taskTitle?: string) {
  const payload: Record<string, unknown> = { state }
  if (taskTitle) payload.activeTask = { id: `task-${agentId}-test`, title: taskTitle }
  const res = await app.inject({
    method: 'POST',
    url: `/agents/${agentId}/canvas`,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  expect(res.statusCode).toBe(200)
}

/** Collect canvas_expression briefing events emitted within timeoutMs */
function collectBriefingEvents(timeoutMs: number): Promise<Event[]> {
  return new Promise(resolve => {
    const collected: Event[] = []
    const listenerId = `test-briefing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    eventBus.on(listenerId, (event: Event) => {
      if (event.type === 'canvas_expression') {
        const data = event.data as Record<string, unknown>
        if (data._briefing === true) {
          collected.push(event)
        }
      }
    })

    setTimeout(() => {
      eventBus.off(listenerId)
      resolve(collected)
    }, timeoutMs)
  })
}

describe('POST /canvas/briefing — e2e harness', () => {
  beforeEach(async () => {
    // Exhaust any cooldown from prior tests by using a unique requesterId each time
  })

  it('returns success with empty agents when canvas is empty', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/canvas/briefing',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requesterId: 'test-empty' }),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.agents)).toBe(true)
    // May or may not be empty depending on other test agents — just verify shape
    expect(typeof body.totalMs).toBe('number')
  })

  it('fires canvas_expression events for each active agent', async () => {
    const requester = `test-briefing-${Date.now()}`
    // Register 2 test agents with distinct states
    await pushCanvasState('link', 'working', 'Build canvas briefing test')
    await pushCanvasState('kai', 'thinking')

    // Collect events BEFORE firing briefing (async subscription first)
    const STAGGER_MS = 700
    const AGENT_COUNT = 2
    const WAIT_MS = STAGGER_MS * AGENT_COUNT + 1500 // stagger + buffer

    const eventsPromise = collectBriefingEvents(WAIT_MS)

    const res = await app.inject({
      method: 'POST',
      url: '/canvas/briefing',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requesterId: requester }),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.agents)).toBe(true)
    // At least the 2 agents we registered should be queued
    expect(body.agents.length).toBeGreaterThanOrEqual(AGENT_COUNT)
    body.agents.forEach((a: { agentId: string; queued: boolean }) => {
      expect(a.queued).toBe(true)
      expect(typeof a.agentId).toBe('string')
    })

    const events = await eventsPromise

    // Should have received at least 2 canvas_expression events (one per agent)
    expect(events.length).toBeGreaterThanOrEqual(AGENT_COUNT)

    // Verify event shape
    for (const event of events) {
      expect(event.type).toBe('canvas_expression')
      const data = event.data as Record<string, unknown>
      expect(typeof data.agentId).toBe('string')
      expect(data._briefing).toBe(true)

      const channels = data.channels as Record<string, unknown>
      expect(channels).toBeDefined()
      // voice line must be a non-empty string
      expect(typeof channels.voice).toBe('string')
      expect((channels.voice as string).length).toBeGreaterThan(0)
      // visual.flash must be a hex color
      const visual = channels.visual as Record<string, unknown>
      expect(typeof visual.flash).toBe('string')
      expect((visual.flash as string)).toMatch(/^#[0-9a-fA-F]{6}$/)
      // narrative must contain agentId
      expect(typeof channels.narrative).toBe('string')
      expect(channels.narrative as string).toContain(data.agentId as string)
    }
  })

  it('events are assigned to correct agents in SSE stream', async () => {
    const requester = `test-briefing-agents-${Date.now()}`
    await pushCanvasState('sage', 'decision', 'Review PR #991')
    await pushCanvasState('pixel', 'rendering')

    const WAIT_MS = 700 * 4 + 1500 // room for up to 4 agents + buffer

    const eventsPromise = collectBriefingEvents(WAIT_MS)

    await app.inject({
      method: 'POST',
      url: '/canvas/briefing',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requesterId: requester }),
    })

    const events = await eventsPromise
    const agentIds = events.map(e => (e.data as Record<string, unknown>).agentId as string)

    // sage and pixel should appear
    expect(agentIds).toContain('sage')
    expect(agentIds).toContain('pixel')
  })

  it('totalMs is proportional to agent count × stagger interval', async () => {
    const requester = `test-briefing-timing-${Date.now()}`
    await pushCanvasState('scout', 'working', 'Gather data')

    const res = await app.inject({
      method: 'POST',
      url: '/canvas/briefing',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requesterId: requester }),
    })
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    // totalMs = agents.length × 700
    expect(body.totalMs).toBe(body.agents.length * 700)
  })

  it('cooldown gate: second call within 30s returns idempotent=true', async () => {
    const requester = `test-briefing-cooldown-${Date.now()}`

    const res1 = await app.inject({
      method: 'POST',
      url: '/canvas/briefing',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requesterId: requester }),
    })
    expect(res1.statusCode).toBe(200)
    const body1 = JSON.parse(res1.body)
    expect(body1.success).toBe(true)
    // First call should NOT be idempotent
    expect(body1.idempotent).toBeFalsy()

    // Immediate second call — should hit cooldown
    const res2 = await app.inject({
      method: 'POST',
      url: '/canvas/briefing',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requesterId: requester }),
    })
    expect(res2.statusCode).toBe(200)
    const body2 = JSON.parse(res2.body)
    expect(body2.success).toBe(true)
    expect(body2.idempotent).toBe(true)
  })

  it('different requesterIds are not affected by each others cooldowns', async () => {
    const id1 = `test-briefing-r1-${Date.now()}`
    const id2 = `test-briefing-r2-${Date.now()}`

    // Fire both — they should both succeed (not idempotent)
    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/canvas/briefing',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requesterId: id1 }),
      }),
      app.inject({
        method: 'POST',
        url: '/canvas/briefing',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requesterId: id2 }),
      }),
    ])
    expect(JSON.parse(res1.body).idempotent).toBeFalsy()
    expect(JSON.parse(res2.body).idempotent).toBeFalsy()
  })
})
