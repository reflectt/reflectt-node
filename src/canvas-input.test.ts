// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const VALID_ACTIONS = ['decision', 'interrupt', 'pause', 'resume', 'mute', 'unmute'] as const
const VALID_CHOICES = ['approve', 'deny', 'defer'] as const

function validateCanvasInput(body: Record<string, unknown>): { valid: boolean; error?: string } {
  const action = body.action as string
  if (!VALID_ACTIONS.includes(action as any)) {
    return { valid: false, error: `action must be one of: ${VALID_ACTIONS.join(', ')}` }
  }
  if (typeof body.actor !== 'string' || !body.actor.trim()) {
    return { valid: false, error: 'actor is required (non-empty string)' }
  }
  if (action === 'decision') {
    if (!body.decisionId) return { valid: false, error: 'decision action requires decisionId' }
    if (!VALID_CHOICES.includes(body.choice as any)) {
      return { valid: false, error: `decision action requires choice: ${VALID_CHOICES.join(', ')}` }
    }
  }
  return { valid: true }
}

describe('canvas input validation', () => {
  it('accepts valid decision input', () => {
    const r = validateCanvasInput({
      action: 'decision',
      actor: 'ryan',
      decisionId: 'dec-123',
      choice: 'approve',
    })
    assert.equal(r.valid, true)
  })

  it('accepts valid interrupt input', () => {
    const r = validateCanvasInput({
      action: 'interrupt',
      actor: 'ryan',
      targetRunId: 'arun-123',
    })
    assert.equal(r.valid, true)
  })

  it('accepts valid pause input', () => {
    const r = validateCanvasInput({ action: 'pause', actor: 'ryan' })
    assert.equal(r.valid, true)
  })

  it('accepts valid resume input', () => {
    const r = validateCanvasInput({ action: 'resume', actor: 'ryan' })
    assert.equal(r.valid, true)
  })

  it('accepts valid mute input', () => {
    const r = validateCanvasInput({ action: 'mute', actor: 'ryan' })
    assert.equal(r.valid, true)
  })

  it('accepts valid unmute input', () => {
    const r = validateCanvasInput({ action: 'unmute', actor: 'ryan' })
    assert.equal(r.valid, true)
  })

  it('rejects missing actor', () => {
    const r = validateCanvasInput({ action: 'interrupt' })
    assert.equal(r.valid, false)
    assert.ok(r.error?.includes('actor'))
  })

  it('rejects invalid action', () => {
    const r = validateCanvasInput({ action: 'explode', actor: 'ryan' })
    assert.equal(r.valid, false)
    assert.ok(r.error?.includes('action'))
  })

  it('rejects decision without decisionId', () => {
    const r = validateCanvasInput({ action: 'decision', actor: 'ryan', choice: 'approve' })
    assert.equal(r.valid, false)
    assert.ok(r.error?.includes('decisionId'))
  })

  it('rejects decision without choice', () => {
    const r = validateCanvasInput({ action: 'decision', actor: 'ryan', decisionId: 'dec-1' })
    assert.equal(r.valid, false)
    assert.ok(r.error?.includes('choice'))
  })

  it('rejects decision with invalid choice', () => {
    const r = validateCanvasInput({ action: 'decision', actor: 'ryan', decisionId: 'dec-1', choice: 'maybe' })
    assert.equal(r.valid, false)
    assert.ok(r.error?.includes('choice'))
  })

  it('accepts all valid decision choices', () => {
    for (const choice of VALID_CHOICES) {
      const r = validateCanvasInput({ action: 'decision', actor: 'ryan', decisionId: 'dec-1', choice })
      assert.equal(r.valid, true, `Expected ${choice} to be valid`)
    }
  })

  it('accepts all valid actions', () => {
    for (const action of VALID_ACTIONS) {
      const extra = action === 'decision' ? { decisionId: 'd-1', choice: 'approve' } : {}
      const r = validateCanvasInput({ action, actor: 'ryan', ...extra })
      assert.equal(r.valid, true, `Expected ${action} to be valid`)
    }
  })
})
