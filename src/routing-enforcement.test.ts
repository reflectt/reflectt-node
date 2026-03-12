// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateRoutingSemantics, VALID_ACTION_REQUIRED, VALID_ROUTING_URGENCY } from './agent-runs.js'

describe('routing semantics enforcement', () => {
  it('non-routing payload on non-actionable events passes', () => {
    assert.equal(validateRoutingSemantics('task_completed', {}).valid, true)
    assert.equal(validateRoutingSemantics('memory_written', {}).valid, true)
  })

  it('review_requested with locked routing vocabulary passes', () => {
    const r = validateRoutingSemantics('review_requested', { action_required: 'review', urgency: 'normal', owner: 'kai' })
    assert.equal(r.valid, true)
  })

  it('routing payload on any event requires both fields', () => {
    const r = validateRoutingSemantics('tool_invoked', { action_required: 'fyi' })
    assert.equal(r.valid, false)
    assert.ok(r.errors.some(e => e.includes('urgency')))
  })

  it('rejects missing action_required', () => {
    const r = validateRoutingSemantics('review_requested', { urgency: 'normal', owner: 'kai' })
    assert.equal(r.valid, false)
    assert.ok(r.errors.some(e => e.includes('action_required')))
  })

  it('rejects missing urgency', () => {
    const r = validateRoutingSemantics('review_requested', { action_required: 'review', owner: 'kai' })
    assert.equal(r.valid, false)
    assert.ok(r.errors.some(e => e.includes('urgency')))
  })

  it('rejects invalid action_required value', () => {
    const r = validateRoutingSemantics('review_requested', { action_required: 'Review PR', urgency: 'normal', owner: 'kai' })
    assert.equal(r.valid, false)
    assert.ok(r.errors.some(e => e.includes('action_required')))
  })

  it('rejects invalid urgency value', () => {
    const r = validateRoutingSemantics('review_requested', { action_required: 'review', urgency: 'high', owner: 'kai' })
    assert.equal(r.valid, false)
    assert.ok(r.errors.some(e => e.includes('urgency')))
  })

  it('accepts all locked action_required values', () => {
    for (const value of VALID_ACTION_REQUIRED) {
      const r = validateRoutingSemantics('review_requested', { action_required: value, urgency: 'normal' })
      assert.equal(r.valid, true, `${value} should be valid`)
    }
  })

  it('accepts all locked urgency values', () => {
    for (const value of VALID_ROUTING_URGENCY) {
      const r = validateRoutingSemantics('review_requested', { action_required: 'review', urgency: value })
      assert.equal(r.valid, true, `${value} should be valid`)
    }
  })

  it('collects both missing-field errors at once', () => {
    const r = validateRoutingSemantics('handoff', {})
    assert.equal(r.valid, false)
    assert.equal(r.errors.length, 2)
  })

  it('warns on non-numeric expires_at', () => {
    const r = validateRoutingSemantics('handoff', { action_required: 'approve', urgency: 'low', expires_at: 'soon' as unknown as number })
    assert.equal(r.valid, true)
    assert.ok(r.warnings.some(w => w.includes('expires_at')))
  })
})
