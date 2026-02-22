// Regression tests: hysteresis flap prevention + audit field presence
import { describe, it, expect, beforeAll } from 'vitest'
import {
  scoreToPriority,
  scoreToPriorityWithHysteresis,
  computeScore,
  buildDecisionTrace,
  ingestReflection,
  SCORING_ENGINE_VERSION,
  HYSTERESIS_BUFFER,
  PRIORITY_THRESHOLDS,
} from '../src/insights.js'
import { createReflection } from '../src/reflections.js'
import type { Reflection } from '../src/reflections.js'

// ── Helpers ──

function makeReflection(overrides: Partial<Parameters<typeof createReflection>[0]> = {}): Reflection {
  return createReflection({
    pain: overrides.pain ?? 'test pain',
    impact: overrides.impact ?? 'test impact',
    evidence: overrides.evidence ?? ['evidence-1'],
    went_well: overrides.went_well ?? 'went well',
    suspected_why: overrides.suspected_why ?? 'suspected why',
    proposed_fix: overrides.proposed_fix ?? 'proposed fix',
    confidence: overrides.confidence ?? 5,
    role_type: overrides.role_type ?? 'agent',
    author: overrides.author ?? `author-${Math.random().toString(36).slice(2, 6)}`,
    severity: overrides.severity,
    tags: overrides.tags ?? [`stage:test`, `family:hysteresis-test-${Date.now()}`, `unit:test`],
  })
}

// ── scoreToPriority (no hysteresis) ──

describe('scoreToPriority (baseline)', () => {
  it('maps scores to priorities at exact thresholds', () => {
    expect(scoreToPriority(8)).toBe('P0')
    expect(scoreToPriority(5)).toBe('P1')
    expect(scoreToPriority(3)).toBe('P2')
    expect(scoreToPriority(2)).toBe('P3')
    expect(scoreToPriority(0)).toBe('P3')
    expect(scoreToPriority(10)).toBe('P0')
  })
})

// ── Hysteresis flap prevention ──

describe('scoreToPriorityWithHysteresis', () => {
  const buf = HYSTERESIS_BUFFER

  it('returns standard priority for new insights (no previous)', () => {
    expect(scoreToPriorityWithHysteresis(8, null)).toBe('P0')
    expect(scoreToPriorityWithHysteresis(5, null)).toBe('P1')
    expect(scoreToPriorityWithHysteresis(3, null)).toBe('P2')
    expect(scoreToPriorityWithHysteresis(1, null)).toBe('P3')
  })

  it('prevents P0→P1 flap when score is in buffer zone', () => {
    // Score = 7.8 (below P0=8 threshold but within buffer)
    // Without hysteresis: P1. With hysteresis from P0: stays P0
    const scoreInBuffer = PRIORITY_THRESHOLDS.P0 - buf + 0.1
    expect(scoreToPriority(scoreInBuffer)).toBe('P1') // raw would downgrade
    expect(scoreToPriorityWithHysteresis(scoreInBuffer, 'P0')).toBe('P0') // hysteresis keeps
  })

  it('allows P0→P1 when score drops clearly below buffer', () => {
    const scoreBelowBuffer = PRIORITY_THRESHOLDS.P0 - buf - 0.1
    expect(scoreToPriorityWithHysteresis(scoreBelowBuffer, 'P0')).not.toBe('P0')
  })

  it('prevents P1→P0 upgrade when score is in buffer zone', () => {
    // Score = 8.1 (above P0=8 but not above P0+buffer)
    const scoreInBuffer = PRIORITY_THRESHOLDS.P0 + buf - 0.1
    expect(scoreToPriorityWithHysteresis(scoreInBuffer, 'P1')).toBe('P1')
  })

  it('allows P1→P0 upgrade when score clearly exceeds threshold', () => {
    const scoreClearlyAbove = PRIORITY_THRESHOLDS.P0 + buf + 0.1
    expect(scoreToPriorityWithHysteresis(scoreClearlyAbove, 'P1')).toBe('P0')
  })

  it('prevents rapid flapping around P1/P2 boundary', () => {
    const justBelow = PRIORITY_THRESHOLDS.P1 - buf + 0.1
    expect(scoreToPriorityWithHysteresis(justBelow, 'P1')).toBe('P1')
    const justAbove = PRIORITY_THRESHOLDS.P1 + buf - 0.1
    expect(scoreToPriorityWithHysteresis(justAbove, 'P2')).toBe('P2')
  })

  it('simulates a flap sequence and shows stability', () => {
    // Start at P1, scores oscillate around 8
    let currentPriority = 'P1'
    const scores = [7.9, 8.1, 7.8, 8.2, 7.9, 8.0]
    const priorities: string[] = []

    for (const s of scores) {
      currentPriority = scoreToPriorityWithHysteresis(s, currentPriority)
      priorities.push(currentPriority)
    }

    // Without hysteresis these would alternate P0/P1. With hysteresis, should be stable.
    const changes = priorities.filter((p, i) => i > 0 && p !== priorities[i - 1]).length
    expect(changes).toBeLessThanOrEqual(1) // at most one real transition
  })
})

// ── Audit fields in ingested insights ──

describe('Decision trace / audit fields', () => {
  it('buildDecisionTrace returns all required fields', () => {
    const ref = makeReflection({ confidence: 7, severity: 'high' })
    const trace = buildDecisionTrace([ref], 'test::family::unit', 'not_ready', null, 8)

    expect(trace.version).toBe(SCORING_ENGINE_VERSION)
    expect(trace.dedupe_cluster_id).toBe('test::family::unit')
    expect(trace.promotion_band).toBe('not_ready')
    expect(trace.raw_score).toBe(8)
    expect(trace.previous_priority).toBeNull()
    expect(trace.top_contributors).toBeInstanceOf(Array)
    expect(trace.top_contributors.length).toBeGreaterThan(0)
    expect(typeof trace.hysteresis_applied).toBe('boolean')

    // Each contributor has required shape
    for (const c of trace.top_contributors) {
      expect(c).toHaveProperty('factor')
      expect(c).toHaveProperty('value')
      expect(c).toHaveProperty('description')
    }
  })

  it('ingestReflection stores audit fields in insight metadata', () => {
    const uniqueFamily = `audit-test-${Date.now()}`
    const ref = makeReflection({
      confidence: 6,
      severity: 'medium',
      tags: [`stage:test`, `family:${uniqueFamily}`, `unit:test`],
    })

    const insight = ingestReflection(ref)

    expect(insight.metadata).toBeDefined()
    expect(insight.metadata!.dedupe_cluster_id).toBe(insight.cluster_key)
    expect(insight.metadata!.promotion_band).toBeTruthy()
    expect(insight.metadata!.scoring_version).toBe(SCORING_ENGINE_VERSION)
    expect(insight.metadata!.decision_trace).toBeDefined()

    const trace = insight.metadata!.decision_trace as any
    expect(trace.version).toBe(SCORING_ENGINE_VERSION)
    expect(trace.top_contributors).toBeInstanceOf(Array)
  })

  it('audit fields update when new reflection is added to existing insight', () => {
    const uniqueFamily = `audit-update-${Date.now()}`
    const tags = [`stage:test`, `family:${uniqueFamily}`, `unit:test`]

    const ref1 = makeReflection({ confidence: 5, tags, author: 'alice' })
    const insight1 = ingestReflection(ref1)

    const ref2 = makeReflection({ confidence: 7, tags, author: 'bob' })
    const insight2 = ingestReflection(ref2)

    expect(insight2.id).toBe(insight1.id) // same cluster
    expect(insight2.metadata).toBeDefined()

    const trace = insight2.metadata!.decision_trace as any
    expect(trace.version).toBe(SCORING_ENGINE_VERSION)
    expect(trace.previous_priority).toBeTruthy() // was set from insight1's priority
    expect(trace.raw_score).toBeGreaterThanOrEqual(insight1.score) // score should increase
  })
})

// ── Config exports ──

describe('Scoring engine config exports', () => {
  it('exports hysteresis buffer and thresholds', () => {
    expect(HYSTERESIS_BUFFER).toBeGreaterThan(0)
    expect(HYSTERESIS_BUFFER).toBeLessThan(1)
    expect(PRIORITY_THRESHOLDS.P0).toBe(8)
    expect(PRIORITY_THRESHOLDS.P1).toBe(5)
    expect(PRIORITY_THRESHOLDS.P2).toBe(3)
  })

  it('exports scoring engine version', () => {
    expect(SCORING_ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
