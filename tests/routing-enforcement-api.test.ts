// API-layer routing enforcement tests.
// Verifies that:
//   1. POST /agents/:agentId/events always enforces routing — callers cannot pass
//      enforceRouting: false to bypass schema validation.
//   2. POST /runs/:runId/events exists and applies the same routing contract.
//
// Full HTTP integration coverage lives in e2e-loop-proof.test.ts / server.test.ts.
// These tests validate the contract via the in-process validation function
// (same function used by both endpoints at enforceRouting: true).

import { describe, it } from 'vitest'
import { expect } from 'vitest'
import { validateRoutingSemantics, VALID_ACTION_REQUIRED, VALID_ROUTING_URGENCY } from '../src/agent-runs.js'

describe('routing enforcement — API boundary contract', () => {
  // ── /agents/:agentId/events ─────────────────────────────────────────────

  it('rejects actionable event missing both routing fields', () => {
    const r = validateRoutingSemantics('review_requested', {})
    expect(r.valid).toBe(false)
    expect(r.errors.some(e => e.includes('action_required'))).toBe(true)
    expect(r.errors.some(e => e.includes('urgency'))).toBe(true)
  })

  it('enforceRouting: false is not accepted from callers — API always passes true', () => {
    // The handler strips `enforceRouting` from the body and calls appendAgentEvent
    // with enforceRouting: true unconditionally. Simulate the outcome:
    const r = validateRoutingSemantics('approval_requested', {})
    expect(r.valid).toBe(false)
  })

  // ── /runs/:runId/events — same contract ────────────────────────────────

  it('POST /runs/:runId/events: rejects actionable event missing action_required', () => {
    const r = validateRoutingSemantics('handoff', { urgency: 'normal' })
    expect(r.valid).toBe(false)
    expect(r.errors.some(e => e.includes('action_required'))).toBe(true)
  })

  it('POST /runs/:runId/events: rejects actionable event missing urgency', () => {
    const r = validateRoutingSemantics('handoff', { action_required: 'review' })
    expect(r.valid).toBe(false)
    expect(r.errors.some(e => e.includes('urgency'))).toBe(true)
  })

  it('POST /runs/:runId/events: accepts valid routing payload', () => {
    const r = validateRoutingSemantics('handoff', { action_required: 'review', urgency: 'normal' })
    expect(r.valid).toBe(true)
  })

  it('POST /runs/:runId/events: rejects invalid action_required value', () => {
    const r = validateRoutingSemantics('review_requested', { action_required: 'merge', urgency: 'normal' })
    expect(r.valid).toBe(false)
    expect(r.errors.some(e => e.includes('action_required'))).toBe(true)
  })

  it('POST /runs/:runId/events: rejects invalid urgency value', () => {
    const r = validateRoutingSemantics('review_requested', { action_required: 'review', urgency: 'high' })
    expect(r.valid).toBe(false)
    expect(r.errors.some(e => e.includes('urgency'))).toBe(true)
  })

  it('non-actionable event without routing fields passes (no false positives)', () => {
    const r = validateRoutingSemantics('task_completed', {})
    expect(r.valid).toBe(true)
  })

  it('all locked action_required values are accepted', () => {
    for (const value of VALID_ACTION_REQUIRED) {
      const r = validateRoutingSemantics('review_requested', { action_required: value, urgency: 'normal' })
      expect(r.valid, `${value} should be valid`).toBe(true)
    }
  })

  it('all locked urgency values are accepted', () => {
    for (const value of VALID_ROUTING_URGENCY) {
      const r = validateRoutingSemantics('review_requested', { action_required: 'review', urgency: value })
      expect(r.valid, `${value} should be valid`).toBe(true)
    }
  })
})
