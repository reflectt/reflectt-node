// Tests for Insight clustering + dedupe/cooldown engine
import { describe, it, expect, beforeEach } from 'vitest'
import {
  ingestReflection,
  getInsight,
  listInsights,
  insightStats,
  tickCooldowns,
  extractClusterKey,
  findByCluster,
  _clearInsightStore,
  COOLDOWN_MS,
  PROMOTION_THRESHOLD,
  computeScore,
  canPromote,
  scoreToPriority,
} from '../src/insights.js'
import {
  createReflection,
  _clearReflectionStore,
} from '../src/reflections.js'
import { getDb } from '../src/db.js'
import type { Reflection } from '../src/reflections.js'

function makeReflection(overrides: Partial<Parameters<typeof createReflection>[0]> = {}): Reflection {
  return createReflection({
    pain: 'Chat messages truncated in task comments',
    impact: 'Team misses context in async handoffs',
    evidence: ['https://github.com/reflectt/reflectt-node/issues/42'],
    went_well: 'Chat relay works — only comment rendering truncates',
    suspected_why: 'chatToComment() slices at 200 chars',
    proposed_fix: 'Remove slice, add expandable UI',
    confidence: 7,
    role_type: 'agent',
    author: 'link',
    tags: ['stage:relay', 'family:data-loss', 'unit:chat'],
    ...overrides,
  })
}

beforeEach(() => {
  _clearInsightStore()
  _clearReflectionStore()
})

// ── Cluster key extraction ──

describe('extractClusterKey', () => {
  it('extracts from tags when present', () => {
    const ref = makeReflection({ tags: ['stage:deploy', 'family:runtime-error', 'unit:api'] })
    const key = extractClusterKey(ref)
    expect(key.workflow_stage).toBe('deploy')
    expect(key.failure_family).toBe('runtime-error')
    expect(key.impacted_unit).toBe('api')
  })

  it('infers failure_family from pain text when no tag', () => {
    const ref = makeReflection({ tags: [], pain: 'Messages truncated in relay' })
    const key = extractClusterKey(ref)
    expect(key.failure_family).toBe('data-loss')
  })

  it('falls back to uncategorized for unknown pain', () => {
    const ref = makeReflection({ tags: [], pain: 'Something happened' })
    const key = extractClusterKey(ref)
    expect(key.failure_family).toBe('uncategorized')
  })

  it('uses team_id as impacted_unit fallback', () => {
    const ref = makeReflection({ tags: ['stage:build'], team_id: 'team-alpha' })
    const key = extractClusterKey(ref)
    expect(key.impacted_unit).toBe('team-alpha')
  })
})

// ── Scoring ──

describe('computeScore', () => {
  it('returns 0 for empty array', () => {
    expect(computeScore([])).toBe(0)
  })

  it('uses max confidence as base', () => {
    const refs = [
      makeReflection({ confidence: 5 }),
      makeReflection({ confidence: 8 }),
    ]
    const score = computeScore(refs)
    expect(score).toBeGreaterThanOrEqual(8)
  })

  it('adds severity boost for high (+1)', () => {
    const base = [makeReflection({ confidence: 5 })]
    const withHigh = [makeReflection({ confidence: 5, severity: 'high' })]
    expect(computeScore(withHigh)).toBeGreaterThan(computeScore(base))
  })

  it('adds severity boost for critical (+2)', () => {
    const withHigh = [makeReflection({ confidence: 5, severity: 'high' })]
    const withCrit = [makeReflection({ confidence: 5, severity: 'critical' })]
    expect(computeScore(withCrit)).toBeGreaterThan(computeScore(withHigh))
  })

  it('adds volume boost for multiple reflections', () => {
    const one = [makeReflection({ confidence: 5 })]
    const three = [
      makeReflection({ confidence: 5 }),
      makeReflection({ confidence: 5 }),
      makeReflection({ confidence: 5 }),
    ]
    expect(computeScore(three)).toBeGreaterThan(computeScore(one))
  })

  it('caps at 10', () => {
    const refs = Array.from({ length: 10 }, () =>
      makeReflection({ confidence: 10, severity: 'critical' })
    )
    expect(computeScore(refs)).toBeLessThanOrEqual(10)
  })
})

describe('scoreToPriority', () => {
  it('maps score ranges correctly', () => {
    expect(scoreToPriority(0)).toBe('P3')
    expect(scoreToPriority(2)).toBe('P3')
    expect(scoreToPriority(3)).toBe('P2')
    expect(scoreToPriority(4)).toBe('P2')
    expect(scoreToPriority(5)).toBe('P1')
    expect(scoreToPriority(7)).toBe('P1')
    expect(scoreToPriority(8)).toBe('P0')
    expect(scoreToPriority(10)).toBe('P0')
  })
})

// ── Promotion gate ──

describe('canPromote', () => {
  it('requires 2 independent authors by default', () => {
    const refs = [
      makeReflection({ author: 'link' }),
      makeReflection({ author: 'link' }),
    ]
    expect(canPromote(refs)).toBe(false)
  })

  it('promotes with 2 different authors', () => {
    const refs = [
      makeReflection({ author: 'link' }),
      makeReflection({ author: 'echo' }),
    ]
    expect(canPromote(refs)).toBe(true)
  })

  it('promotes single high-severity reflection with evidence (override)', () => {
    const refs = [
      makeReflection({ severity: 'high', evidence: ['proof.log'] }),
    ]
    expect(canPromote(refs)).toBe(true)
  })

  it('promotes single critical-severity reflection with evidence', () => {
    const refs = [
      makeReflection({ severity: 'critical', evidence: ['crash-dump.txt'] }),
    ]
    expect(canPromote(refs)).toBe(true)
  })

  it('does NOT promote low-severity single reflection', () => {
    const refs = [
      makeReflection({ severity: 'low' }),
    ]
    expect(canPromote(refs)).toBe(false)
  })

  it('does NOT promote single reflection with no severity', () => {
    const refs = [makeReflection()]
    expect(canPromote(refs)).toBe(false)
  })
})

// ── Ingestion ──

describe('ingestReflection', () => {
  it('creates a candidate insight from first reflection', () => {
    const ref = makeReflection()
    const insight = ingestReflection(ref)

    expect(insight.id).toMatch(/^ins-/)
    expect(insight.status).toBe('candidate')
    expect(insight.reflection_ids).toContain(ref.id)
    expect(insight.score).toBeGreaterThan(0)
    expect(insight.independent_count).toBe(1)
    expect(insight.authors).toContain('link')
  })

  it('clusters second reflection into same insight', () => {
    const ref1 = makeReflection({ author: 'link' })
    const ins1 = ingestReflection(ref1)

    const ref2 = makeReflection({ author: 'link', pain: 'More truncation' })
    const ins2 = ingestReflection(ref2)

    expect(ins2.id).toBe(ins1.id)
    expect(ins2.reflection_ids).toHaveLength(2)
    expect(ins2.independent_count).toBe(1) // same author
  })

  it('promotes when 2 independent authors contribute', () => {
    const ref1 = makeReflection({ author: 'link' })
    ingestReflection(ref1)

    const ref2 = makeReflection({ author: 'echo' })
    const insight = ingestReflection(ref2)

    expect(insight.status).toBe('promoted')
    expect(insight.cooldown_until).not.toBeNull()
    expect(insight.independent_count).toBe(2)
    expect(insight.promotion_readiness).toBe('promoted')
  })

  it('promotes immediately with high-severity override', () => {
    const ref = makeReflection({ severity: 'critical', evidence: ['crash.log'] })
    const insight = ingestReflection(ref)

    expect(insight.status).toBe('promoted')
    expect(insight.promotion_readiness).toBe('override')
    expect(insight.severity_max).toBe('critical')
  })

  it('deduplicates same reflection id', () => {
    const ref = makeReflection()
    const ins1 = ingestReflection(ref)
    const ins2 = ingestReflection(ref)

    expect(ins2.reflection_ids).toHaveLength(1)
    expect(ins2.id).toBe(ins1.id)
  })

  it('assigns different clusters to different failure families', () => {
    const ref1 = makeReflection({ tags: ['stage:relay', 'family:data-loss', 'unit:chat'] })
    const ref2 = makeReflection({ tags: ['stage:deploy', 'family:runtime-error', 'unit:api'] })

    const ins1 = ingestReflection(ref1)
    const ins2 = ingestReflection(ref2)

    expect(ins1.id).not.toBe(ins2.id)
    expect(ins1.cluster_key).not.toBe(ins2.cluster_key)
  })

  it('tracks evidence refs across reflections', () => {
    const ref1 = makeReflection({ author: 'link', evidence: ['a.log'] })
    ingestReflection(ref1)

    const ref2 = makeReflection({ author: 'link', evidence: ['b.log'] })
    const insight = ingestReflection(ref2)

    expect(insight.evidence_refs).toContain('a.log')
    expect(insight.evidence_refs).toContain('b.log')
  })
})

// ── Cooldown ──

describe('cooldown', () => {
  it('tickCooldowns moves expired promoted to cooldown', () => {
    const ref = makeReflection({ severity: 'critical', evidence: ['proof.log'] })
    const insight = ingestReflection(ref)
    expect(insight.status).toBe('promoted')

    const db = getDb()
    db.prepare('UPDATE insights SET cooldown_until = ? WHERE id = ?')
      .run(Date.now() - 1000, insight.id)

    const result = tickCooldowns()
    expect(result.cooled).toBe(1)

    const updated = getInsight(insight.id)!
    expect(updated.status).toBe('cooldown')
  })

  it('tickCooldowns closes old cooldown entries', () => {
    const ref = makeReflection({ severity: 'critical', evidence: ['proof.log'] })
    const insight = ingestReflection(ref)

    const db = getDb()
    const past = Date.now() - COOLDOWN_MS - 1000
    db.prepare('UPDATE insights SET status = ?, cooldown_until = ?, updated_at = ? WHERE id = ?')
      .run('cooldown', past, past, insight.id)

    const result = tickCooldowns()
    expect(result.closed).toBe(1)

    const updated = getInsight(insight.id)!
    expect(updated.status).toBe('closed')
  })

  it('reopens cooldown insight when new reflection arrives', () => {
    const ref1 = makeReflection({ severity: 'critical', evidence: ['proof.log'], author: 'link' })
    const insight = ingestReflection(ref1)
    expect(insight.status).toBe('promoted')

    // Put in cooldown (still within window)
    const db = getDb()
    db.prepare('UPDATE insights SET status = ?, cooldown_until = ? WHERE id = ?')
      .run('cooldown', Date.now() + COOLDOWN_MS, insight.id)

    // New reflection triggers reopen
    const ref2 = makeReflection({ author: 'echo' })
    const reopened = ingestReflection(ref2)

    expect(reopened.id).toBe(insight.id)
    expect(reopened.status).toBe('promoted')
    expect(reopened.recurring_candidate).toBe(true)
    expect(reopened.cooldown_reason).toBe('reopened')
  })
})

// ── List + Stats ──

describe('listInsights', () => {
  it('lists insights with total count', () => {
    const ref1 = makeReflection({ tags: ['stage:a', 'family:data-loss', 'unit:x'] })
    const ref2 = makeReflection({ tags: ['stage:b', 'family:runtime-error', 'unit:y'] })
    ingestReflection(ref1)
    ingestReflection(ref2)

    const { insights, total } = listInsights()
    expect(total).toBe(2)
    expect(insights).toHaveLength(2)
  })

  it('filters by status', () => {
    const ref = makeReflection({ severity: 'critical', evidence: ['proof.log'] })
    ingestReflection(ref)

    const { insights } = listInsights({ status: 'promoted' })
    expect(insights).toHaveLength(1)

    const { insights: candidates } = listInsights({ status: 'candidate' })
    expect(candidates).toHaveLength(0)
  })

  it('filters by priority', () => {
    const ref = makeReflection({ confidence: 9, severity: 'critical', evidence: ['proof.log'] })
    ingestReflection(ref)

    const { insights } = listInsights({ priority: 'P0' })
    expect(insights).toHaveLength(1)
  })
})

describe('insightStats', () => {
  it('returns aggregate stats', () => {
    const ref1 = makeReflection({ severity: 'critical', evidence: ['a.log'], tags: ['stage:a', 'family:data-loss', 'unit:x'] })
    const ref2 = makeReflection({ tags: ['stage:b', 'family:runtime-error', 'unit:y'] })
    ingestReflection(ref1)
    ingestReflection(ref2)

    const stats = insightStats()
    expect(stats.total).toBe(2)
    expect(stats.by_status.promoted).toBe(1)
    expect(stats.by_status.candidate).toBe(1)
    expect(stats.by_failure_family['data-loss']).toBe(1)
    expect(stats.by_failure_family['runtime-error']).toBe(1)
  })
})

// ── findByCluster ──

describe('findByCluster', () => {
  it('finds existing non-closed insight', () => {
    const ref = makeReflection()
    const ins = ingestReflection(ref)

    const found = findByCluster(ins.cluster_key)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(ins.id)
  })

  it('returns null when no match', () => {
    expect(findByCluster('x::y::z')).toBeNull()
  })

  it('ignores closed insights', () => {
    const ref = makeReflection()
    const ins = ingestReflection(ref)

    const db = getDb()
    db.prepare('UPDATE insights SET status = ? WHERE id = ?').run('closed', ins.id)

    expect(findByCluster(ins.cluster_key)).toBeNull()
  })
})
