// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Tests for handoff state validation schema.
 * The actual server integration is tested via the PATCH /tasks/:id flow,
 * but we test the schema shape here to catch regressions early.
 */

const VALID_DECISIONS = ['approved', 'rejected', 'needs_changes', 'escalated'] as const

function validateHandoffState(input: unknown): { valid: boolean; error?: string } {
  if (!input || typeof input !== 'object') return { valid: false, error: 'must be an object' }
  const obj = input as Record<string, unknown>

  if (typeof obj.reviewed_by !== 'string' || !obj.reviewed_by.trim()) {
    return { valid: false, error: 'reviewed_by is required (non-empty string)' }
  }
  if (!VALID_DECISIONS.includes(obj.decision as any)) {
    return { valid: false, error: `decision must be one of: ${VALID_DECISIONS.join(', ')}` }
  }
  if (obj.next_owner !== undefined && (typeof obj.next_owner !== 'string' || !obj.next_owner.trim())) {
    return { valid: false, error: 'next_owner must be a non-empty string if provided' }
  }

  // Max 3 fields (COO rule)
  const knownKeys = new Set(['reviewed_by', 'decision', 'next_owner'])
  const extraKeys = Object.keys(obj).filter(k => !knownKeys.has(k))
  if (extraKeys.length > 0) {
    return { valid: false, error: `Unknown fields: ${extraKeys.join(', ')}. Max 3 columns per COO rule.` }
  }

  return { valid: true }
}

describe('handoff state validation', () => {
  it('accepts valid handoff with all 3 fields', () => {
    const result = validateHandoffState({
      reviewed_by: 'sage',
      decision: 'approved',
      next_owner: 'link',
    })
    assert.equal(result.valid, true)
  })

  it('accepts valid handoff without next_owner', () => {
    const result = validateHandoffState({
      reviewed_by: 'kai',
      decision: 'rejected',
    })
    assert.equal(result.valid, true)
  })

  it('rejects missing reviewed_by', () => {
    const result = validateHandoffState({
      decision: 'approved',
    })
    assert.equal(result.valid, false)
    assert.ok(result.error?.includes('reviewed_by'))
  })

  it('rejects missing decision', () => {
    const result = validateHandoffState({
      reviewed_by: 'sage',
    })
    assert.equal(result.valid, false)
    assert.ok(result.error?.includes('decision'))
  })

  it('rejects invalid decision value', () => {
    const result = validateHandoffState({
      reviewed_by: 'sage',
      decision: 'maybe',
    })
    assert.equal(result.valid, false)
    assert.ok(result.error?.includes('decision'))
  })

  it('rejects extra fields (COO 3-column rule)', () => {
    const result = validateHandoffState({
      reviewed_by: 'sage',
      decision: 'approved',
      next_owner: 'link',
      extra_field: 'not allowed',
    })
    assert.equal(result.valid, false)
    assert.ok(result.error?.includes('extra_field'))
  })

  it('accepts all valid decision types', () => {
    for (const decision of VALID_DECISIONS) {
      const result = validateHandoffState({
        reviewed_by: 'sage',
        decision,
      })
      assert.equal(result.valid, true, `Expected ${decision} to be valid`)
    }
  })

  it('rejects null input', () => {
    assert.equal(validateHandoffState(null).valid, false)
  })

  it('rejects non-object input', () => {
    assert.equal(validateHandoffState('string').valid, false)
  })

  it('rejects empty reviewed_by', () => {
    const result = validateHandoffState({
      reviewed_by: '  ',
      decision: 'approved',
    })
    assert.equal(result.valid, false)
  })
})
