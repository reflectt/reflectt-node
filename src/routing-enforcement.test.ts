// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const ACTIONABLE = new Set(['review_requested', 'approval_requested', 'escalation', 'handoff'])
const VALID_URGENCY = new Set(['low', 'normal', 'high', 'critical'])

function validate(eventType: string, payload: Record<string, unknown>): { valid: boolean; errors: string[] } {
  if (!ACTIONABLE.has(eventType)) return { valid: true, errors: [] }
  const errors: string[] = []
  if (!payload.action_required || typeof payload.action_required !== 'string') errors.push('action_required required')
  if (!payload.urgency || typeof payload.urgency !== 'string') errors.push('urgency required')
  else if (!VALID_URGENCY.has(payload.urgency as string)) errors.push('invalid urgency')
  if (!payload.owner || typeof payload.owner !== 'string') errors.push('owner required')
  return { valid: errors.length === 0, errors }
}

describe('routing semantics enforcement', () => {
  it('non-actionable events always pass', () => {
    assert.equal(validate('task_completed', {}).valid, true)
    assert.equal(validate('memory_written', {}).valid, true)
    assert.equal(validate('run_started', {}).valid, true)
  })

  it('review_requested with all fields passes', () => {
    const r = validate('review_requested', { action_required: 'Review PR', urgency: 'normal', owner: 'kai' })
    assert.equal(r.valid, true)
  })

  it('approval_requested with all fields passes', () => {
    const r = validate('approval_requested', { action_required: 'Deploy?', urgency: 'high', owner: 'ryan' })
    assert.equal(r.valid, true)
  })

  it('escalation with all fields passes', () => {
    const r = validate('escalation', { action_required: 'Server down', urgency: 'critical', owner: 'link' })
    assert.equal(r.valid, true)
  })

  it('handoff with all fields passes', () => {
    const r = validate('handoff', { action_required: 'Continue build', urgency: 'normal', owner: 'pixel' })
    assert.equal(r.valid, true)
  })

  it('rejects missing action_required', () => {
    const r = validate('review_requested', { urgency: 'normal', owner: 'kai' })
    assert.equal(r.valid, false)
    assert.ok(r.errors.some(e => e.includes('action_required')))
  })

  it('rejects missing urgency', () => {
    const r = validate('review_requested', { action_required: 'Review', owner: 'kai' })
    assert.equal(r.valid, false)
    assert.ok(r.errors.some(e => e.includes('urgency')))
  })

  it('rejects missing owner', () => {
    const r = validate('review_requested', { action_required: 'Review', urgency: 'normal' })
    assert.equal(r.valid, false)
    assert.ok(r.errors.some(e => e.includes('owner')))
  })

  it('rejects invalid urgency value', () => {
    const r = validate('review_requested', { action_required: 'Review', urgency: 'medium', owner: 'kai' })
    assert.equal(r.valid, false)
    assert.ok(r.errors.some(e => e.includes('urgency')))
  })

  it('accepts all valid urgency levels', () => {
    for (const u of ['low', 'normal', 'high', 'critical']) {
      const r = validate('review_requested', { action_required: 'Test', urgency: u, owner: 'kai' })
      assert.equal(r.valid, true, `${u} should be valid`)
    }
  })

  it('rejects empty payload for actionable event', () => {
    const r = validate('approval_requested', {})
    assert.equal(r.valid, false)
    assert.equal(r.errors.length, 3) // missing all 3 required fields
  })

  it('collects all errors at once', () => {
    const r = validate('escalation', {})
    assert.equal(r.errors.length, 3)
  })

  it('rejects non-string action_required', () => {
    const r = validate('review_requested', { action_required: 123, urgency: 'normal', owner: 'kai' })
    assert.equal(r.valid, false)
  })

  it('rejects non-string owner', () => {
    const r = validate('review_requested', { action_required: 'Review', urgency: 'normal', owner: 42 })
    assert.equal(r.valid, false)
  })
})
