// Regression tests: routing override lifecycle + audit schema + validation
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createOverride,
  getOverride,
  listOverrides,
  findActiveOverride,
  validateOverrideInput,
  tickOverrideLifecycle,
  _clearOverrides,
  type CreateOverrideInput,
} from '../src/routing-override.js'

// ── Helpers ──

function validInput(overrides: Partial<CreateOverrideInput> = {}): CreateOverrideInput {
  const now = Date.now()
  return {
    target: 'link',
    target_type: 'agent',
    original_channel: 'general',
    override_channel: 'ops',
    reason: 'test override',
    created_by: 'sage',
    override_expires_at: now + 60_000,     // 1 min from now
    override_recheck_at: now + 30_000,     // 30s from now (before expiry)
    ...overrides,
  }
}

beforeEach(() => {
  _clearOverrides()
})

// ── Validation ──

describe('validateOverrideInput', () => {
  it('accepts valid input', () => {
    const result = validateOverrideInput(validInput())
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects when override_recheck_at >= override_expires_at', () => {
    const now = Date.now()
    const result = validateOverrideInput(validInput({
      override_recheck_at: now + 60_000,
      override_expires_at: now + 60_000,  // equal — must be strictly less
    }))
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('override_recheck_at must be strictly less than override_expires_at')
  })

  it('rejects when override_recheck_at > override_expires_at', () => {
    const now = Date.now()
    const result = validateOverrideInput(validInput({
      override_recheck_at: now + 120_000,
      override_expires_at: now + 60_000,
    }))
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('strictly less'))).toBe(true)
  })

  it('rejects missing required fields', () => {
    const result = validateOverrideInput({
      target: '',
      target_type: 'agent',
      original_channel: '',
      override_channel: 'ops',
      reason: '',
      created_by: 'sage',
      override_expires_at: Date.now() + 60_000,
      override_recheck_at: Date.now() + 30_000,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

// ── Creation + Audit Schema ──

describe('createOverride', () => {
  it('creates override with full audit schema', () => {
    const override = createOverride(validInput())

    expect(override.id).toMatch(/^rovr-/)
    expect(override.status).toBe('active')
    expect(override.policy_version).toBeTruthy()
    expect(override.request_id).toMatch(/^rreq-/)
    expect(override.correlation_id).toMatch(/^rcor-/)
    expect(override.audit_event_ids).toHaveLength(1)
    expect(override.audit_event_ids[0]).toMatch(/^revt-/)
  })

  it('includes policy_version in audit schema', () => {
    const override = createOverride(validInput())
    expect(override.policy_version).toBeDefined()
    expect(typeof override.policy_version).toBe('string')
    expect(override.policy_version.length).toBeGreaterThan(0)
  })

  it('includes request_id and correlation_id', () => {
    const override = createOverride(validInput({
      request_id: 'custom-req-123',
      correlation_id: 'custom-cor-456',
    }))
    expect(override.request_id).toBe('custom-req-123')
    expect(override.correlation_id).toBe('custom-cor-456')
  })

  it('auto-generates request_id and correlation_id when not provided', () => {
    const override = createOverride(validInput())
    expect(override.request_id).toBeTruthy()
    expect(override.correlation_id).toBeTruthy()
  })
})

// ── Lifecycle: active → override_expired → mismatch_blocked ──

describe('tickOverrideLifecycle', () => {
  it('transitions active → override_expired when past expiry', () => {
    const now = Date.now()
    const override = createOverride(validInput({
      override_expires_at: now - 1000,    // already expired
      override_recheck_at: now - 2000,
    }))

    const result = tickOverrideLifecycle(now)

    // Should have expired AND blocked in same tick
    expect(result.expired.length).toBe(1)
    expect(result.expired[0].previous_status).toBe('active')
    expect(result.expired[0].new_status).toBe('override_expired')
    expect(result.expired[0].audit_event_id).toMatch(/^revt-/)

    expect(result.blocked.length).toBe(1)
    expect(result.blocked[0].previous_status).toBe('override_expired')
    expect(result.blocked[0].new_status).toBe('mismatch_blocked')
    expect(result.blocked[0].audit_event_id).toMatch(/^revt-/)

    // Final state should be mismatch_blocked
    const refreshed = getOverride(override.id)!
    expect(refreshed.status).toBe('mismatch_blocked')

    // Should have 3 audit event IDs (created + expired + blocked)
    expect(refreshed.audit_event_ids).toHaveLength(3)
  })

  it('does not expire active overrides before expiry time', () => {
    createOverride(validInput({
      override_expires_at: Date.now() + 60_000,
      override_recheck_at: Date.now() + 30_000,
    }))

    const result = tickOverrideLifecycle(Date.now())
    expect(result.expired).toHaveLength(0)
    expect(result.blocked).toHaveLength(0)
  })

  it('deterministic: override_expired always transitions to mismatch_blocked', () => {
    const now = Date.now()
    createOverride(validInput({
      override_expires_at: now - 1000,
      override_recheck_at: now - 2000,
    }))

    // First tick: active → expired → blocked
    tickOverrideLifecycle(now)

    // Second tick: no further transitions
    const result2 = tickOverrideLifecycle(now + 1000)
    expect(result2.expired).toHaveLength(0)
    expect(result2.blocked).toHaveLength(0)
  })

  it('each transition generates a unique audit event ID', () => {
    const now = Date.now()
    const override = createOverride(validInput({
      override_expires_at: now - 1000,
      override_recheck_at: now - 2000,
    }))

    const result = tickOverrideLifecycle(now)

    const allEventIds = [
      ...result.expired.map(r => r.audit_event_id),
      ...result.blocked.map(r => r.audit_event_id),
    ]
    const unique = new Set(allEventIds)
    expect(unique.size).toBe(allEventIds.length) // all unique

    // Override record should have all event IDs
    const refreshed = getOverride(override.id)!
    for (const eid of allEventIds) {
      expect(refreshed.audit_event_ids).toContain(eid)
    }
  })
})

// ── Query ──

describe('listOverrides + findActiveOverride', () => {
  it('lists overrides by status', () => {
    createOverride(validInput())
    const active = listOverrides({ status: 'active' })
    expect(active.length).toBeGreaterThanOrEqual(1)
    expect(active.every(o => o.status === 'active')).toBe(true)
  })

  it('findActiveOverride returns the latest active override', () => {
    createOverride(validInput({ target: 'link', target_type: 'agent' }))
    const found = findActiveOverride('link', 'agent')
    expect(found).not.toBeNull()
    expect(found!.target).toBe('link')
    expect(found!.status).toBe('active')
  })

  it('findActiveOverride returns null when no active override', () => {
    const found = findActiveOverride('nonexistent', 'agent')
    expect(found).toBeNull()
  })
})
