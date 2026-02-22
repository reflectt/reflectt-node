// Regression: synthetic/sparse reflections must not auto-promote insights
import { describe, it, expect } from 'vitest'
import { canPromote, hasMinimumQuality, ingestReflection } from '../src/insights.js'
import { createReflection } from '../src/reflections.js'
import type { Reflection } from '../src/reflections.js'

function makeRef(overrides: Partial<Parameters<typeof createReflection>[0]> = {}): Reflection {
  return createReflection({
    pain: overrides.pain ?? 'A real problem with meaningful description',
    impact: overrides.impact ?? 'This blocks production deployments for the whole team',
    evidence: overrides.evidence ?? ['https://ci.example.com/build/123'],
    went_well: overrides.went_well ?? 'Detection was fast thanks to monitoring',
    suspected_why: overrides.suspected_why ?? 'Race condition in the deployment pipeline between build and verify steps',
    proposed_fix: overrides.proposed_fix ?? 'Add mutex lock around deploy step and verify sequentially',
    confidence: overrides.confidence ?? 7,
    role_type: overrides.role_type ?? 'agent',
    author: overrides.author ?? `author-${Math.random().toString(36).slice(2, 6)}`,
    severity: overrides.severity,
    tags: overrides.tags ?? [`stage:test`, `family:quality-gate-${Date.now()}`, `unit:test`],
  })
}

describe('hasMinimumQuality', () => {
  it('returns true for reflections with substantive content', () => {
    const ref = makeRef()
    expect(hasMinimumQuality(ref)).toBe(true)
  })

  it('returns false for sparse/synthetic reflections', () => {
    const ref = makeRef({
      pain: 'smoke chain',
      impact: 'verify',
      suspected_why: 'test',
      proposed_fix: 'test',
    })
    expect(hasMinimumQuality(ref)).toBe(false)
  })

  it('returns false when most fields are too short', () => {
    const ref = makeRef({
      pain: 'short',
      impact: 'x',
      suspected_why: 'y',
      proposed_fix: 'A reasonable fix that should pass quality check',
    })
    expect(hasMinimumQuality(ref)).toBe(false) // only 1 of 4 passes, need 3
  })
})

describe('canPromote quality gate', () => {
  it('blocks promotion of sparse high-severity reflections', () => {
    const sparse = makeRef({
      pain: 'smoke chain',
      impact: 'verify',
      suspected_why: 'test',
      proposed_fix: 'test',
      severity: 'high',
    })
    expect(canPromote([sparse])).toBe(false)
  })

  it('allows promotion of quality high-severity reflections', () => {
    const quality = makeRef({ severity: 'high' })
    expect(canPromote([quality])).toBe(true)
  })

  it('blocks promotion even with 2 authors if all reflections are sparse', () => {
    const sparse1 = makeRef({
      pain: 'test', impact: 'test', suspected_why: 'x', proposed_fix: 'x',
      author: 'alice',
    })
    const sparse2 = makeRef({
      pain: 'test', impact: 'test', suspected_why: 'y', proposed_fix: 'y',
      author: 'bob',
    })
    expect(canPromote([sparse1, sparse2])).toBe(false)
  })

  it('allows promotion with 2 quality authors', () => {
    const ref1 = makeRef({ author: 'alice' })
    const ref2 = makeRef({ author: 'bob' })
    expect(canPromote([ref1, ref2])).toBe(true)
  })

  it('allows promotion with mixed: 1 quality + 1 sparse from different authors', () => {
    const quality = makeRef({ author: 'alice' })
    const sparse = makeRef({
      pain: 'x', impact: 'y', suspected_why: 'z', proposed_fix: 'w',
      author: 'bob',
    })
    // At least one quality reflection exists + 2 independent authors
    expect(canPromote([quality, sparse])).toBe(true)
  })
})

describe('ingestReflection with sparse content', () => {
  it('sparse reflection creates candidate insight, NOT promoted', () => {
    const sparse = makeRef({
      pain: 'smoke chain',
      impact: 'verify',
      suspected_why: 'test',
      proposed_fix: 'test',
      severity: 'high',
      tags: [`stage:ops`, `family:smoke-gate-${Date.now()}`, `unit:pipeline`],
    })
    const insight = ingestReflection(sparse)
    expect(insight.status).toBe('candidate')
    expect(insight.promotion_readiness).toBe('not_ready')
  })
})
