// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const CANVAS_STATES = ['floor', 'listening', 'thinking', 'rendering', 'ambient', 'decision', 'urgent', 'handoff'] as const
const SENSOR_VALUES = [null, 'mic', 'camera', 'mic+camera'] as const

function validateCanvasRender(body: Record<string, unknown>): { valid: boolean; error?: string } {
  if (!CANVAS_STATES.includes(body.state as any)) {
    return { valid: false, error: `state must be one of: ${CANVAS_STATES.join(', ')}` }
  }
  if (body.sensors !== undefined && body.sensors !== null && !['mic', 'camera', 'mic+camera'].includes(body.sensors as string)) {
    return { valid: false, error: 'sensors must be null, mic, camera, or mic+camera' }
  }
  if (typeof body.agentId !== 'string' || !body.agentId) {
    return { valid: false, error: 'agentId is required' }
  }
  // Validate decision payload if state is decision
  if (body.state === 'decision' && body.payload) {
    const p = body.payload as any
    if (p.decision && (!p.decision.question || !p.decision.decisionId)) {
      return { valid: false, error: 'decision payload requires question and decisionId' }
    }
  }
  return { valid: true }
}

describe('canvas render state validation', () => {
  it('accepts all 8 valid states', () => {
    for (const state of CANVAS_STATES) {
      const r = validateCanvasRender({ state, agentId: 'link', sensors: null })
      assert.equal(r.valid, true, `${state} should be valid`)
    }
  })

  it('rejects invalid state', () => {
    const r = validateCanvasRender({ state: 'exploding', agentId: 'link' })
    assert.equal(r.valid, false)
  })

  it('accepts all valid sensor values', () => {
    for (const s of SENSOR_VALUES) {
      const r = validateCanvasRender({ state: 'floor', agentId: 'link', sensors: s })
      assert.equal(r.valid, true, `sensor ${s} should be valid`)
    }
  })

  it('rejects invalid sensor', () => {
    const r = validateCanvasRender({ state: 'floor', agentId: 'link', sensors: 'lidar' })
    assert.equal(r.valid, false)
  })

  it('requires agentId', () => {
    const r = validateCanvasRender({ state: 'floor' })
    assert.equal(r.valid, false)
    assert.ok(r.error?.includes('agentId'))
  })

  it('accepts floor with empty payload', () => {
    const r = validateCanvasRender({ state: 'floor', agentId: 'link', sensors: null, payload: {} })
    assert.equal(r.valid, true)
  })

  it('accepts thinking with text payload', () => {
    const r = validateCanvasRender({ state: 'thinking', agentId: 'link', sensors: null, payload: { text: 'Working on PR...' } })
    assert.equal(r.valid, true)
  })

  it('accepts decision with full decision payload', () => {
    const r = validateCanvasRender({
      state: 'decision', agentId: 'link', sensors: null,
      payload: { decision: { question: 'Deploy?', decisionId: 'dec-1', expiresAt: Date.now() + 60000, autoAction: 'defer' } },
    })
    assert.equal(r.valid, true)
  })

  it('rejects decision payload missing question', () => {
    const r = validateCanvasRender({
      state: 'decision', agentId: 'link', sensors: null,
      payload: { decision: { decisionId: 'dec-1' } },
    })
    assert.equal(r.valid, false)
  })

  it('accepts handoff with summary payload', () => {
    const r = validateCanvasRender({
      state: 'handoff', agentId: 'link', sensors: null,
      payload: { summary: { headline: 'Session complete', items: ['3 PRs merged'], cost: '$0.42', duration: '2h' } },
    })
    assert.equal(r.valid, true)
  })

  it('accepts ambient with agents list', () => {
    const r = validateCanvasRender({
      state: 'ambient', agentId: 'link', sensors: null,
      payload: { agents: [{ name: 'link', state: 'idle' }, { name: 'pixel', state: 'working', task: 'UX flow' }] },
    })
    assert.equal(r.valid, true)
  })

  it('accepts urgent with mic sensor', () => {
    const r = validateCanvasRender({
      state: 'urgent', agentId: 'link', sensors: 'mic',
      payload: { text: 'Server down!' },
    })
    assert.equal(r.valid, true)
  })
})
