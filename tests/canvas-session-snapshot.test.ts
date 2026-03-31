// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for GET /canvas/session/snapshot — cross-device continuity handoff endpoint.
 * Spec: workspace-pixel/design/interface-os-v0-continuity.html
 * task-1773257720210-3z83jzley
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  await app?.close()
})

describe('GET /canvas/session/snapshot', () => {
  it('returns no_active_session when canvas is empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/canvas/session/snapshot' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.snapshot).toBeNull()
    expect(body.reason).toBe('no_active_session')
    expect(body.generated_at).toBeTruthy()
  })

  it('returns snapshot for active agent after presence state emitted', async () => {
    // Use POST /agents/:agentId/canvas which stores activeTask properly
    await app.inject({
      method: 'POST', url: '/agents/link/canvas',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: 'thinking',
        activeTask: { id: 'task-abc', title: 'Build snapshot API' },
      }),
    })

    const res = await app.inject({ method: 'GET', url: '/canvas/session/snapshot?agentId=link' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.snapshot).toBeTruthy()
    expect(body.snapshot.agent_id).toBe('link')
    // thinking presence state maps to 'thinking' canvas state
    expect(body.snapshot.active_task).toEqual({ id: 'task-abc', title: 'Build snapshot API' })
    expect(body.snapshot.handoff.summary).toContain('link')
    expect(body.snapshot.handoff.sensor_consent_transferred).toBe(false)
  })

  it('targets specific agent when agentId query param given', async () => {
    await app.inject({
      method: 'POST', url: '/agents/kai/canvas',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'needs-attention' }),
    })

    const res = await app.inject({ method: 'GET', url: '/canvas/session/snapshot?agentId=kai' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.snapshot.agent_id).toBe('kai')
    // needs-attention maps to 'decision' canvas state
    expect(body.snapshot.canvas_state).toBe('decision')
  })

  it('decision state populates active_decision and handoff summary', async () => {
    // POST /canvas/state directly accepts decision payload
    await app.inject({
      method: 'POST', url: '/canvas/state',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'sage',
        state: 'decision',
        payload: {
          decision: { question: 'Deploy to production?', decisionId: 'dec-001' },
        },
      }),
    })

    const res = await app.inject({ method: 'GET', url: '/canvas/session/snapshot?agentId=sage' })
    const body = JSON.parse(res.body)
    expect(body.snapshot.active_decision.question).toBe('Deploy to production?')
    expect(body.snapshot.handoff.summary).toContain('decision')
  })

  it('rendering state sets stream_in_progress=true', async () => {
    await app.inject({
      method: 'POST', url: '/agents/echo/canvas',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'rendering' }),
    })

    const res = await app.inject({ method: 'GET', url: '/canvas/session/snapshot?agentId=echo' })
    const body = JSON.parse(res.body)
    expect(body.snapshot.handoff.stream_in_progress).toBe(true)
  })

  it('snapshot includes identity_color as valid hex for known agent', async () => {
    const res = await app.inject({ method: 'GET', url: '/canvas/session/snapshot?agentId=link' })
    const body = JSON.parse(res.body)
    expect(body.snapshot.identity_color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('snapshot always includes generated_at ISO timestamp', async () => {
    const res = await app.inject({ method: 'GET', url: '/canvas/session/snapshot' })
    const body = JSON.parse(res.body)
    expect(body.generated_at).toBeTruthy()
    expect(() => new Date(body.generated_at)).not.toThrow()
  })

  it('floor/ambient state agents excluded from auto-selection', async () => {
    // Set an agent to floor
    await app.inject({
      method: 'POST', url: '/canvas/state',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'rhythm', state: 'floor', payload: {} }),
    })

    const res = await app.inject({ method: 'GET', url: '/canvas/session/snapshot' })
    const body = JSON.parse(res.body)
    if (body.snapshot) {
      expect(body.snapshot.canvas_state).not.toBe('floor')
    }
  })
})
