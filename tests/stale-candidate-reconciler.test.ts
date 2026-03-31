/**
 * Tests for stale candidate insight reconciler.
 * task-1773493678330-trwv1ahk0
 *
 * Covers: ins-1772993714666-qqvx2uxjq-style stale-candidate scenario
 * — candidate remains P0 after lane recovery (done tasks + merged PRs)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock the DB layer ──────────────────────────────────────────────────────

const mockInsights: Map<string, any> = new Map()
const mockTasks: Array<{ id: string; title: string; status: string; priority: string; metadata: string | null }> = []
const closedInsights: Array<{ insightId: string; reason: string }> = []

vi.mock('../src/db.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (...args: any[]) => {
        if (sql.includes('FROM insights WHERE id = ?')) {
          return mockInsights.get(args[0]) ?? null
        }
        return null
      },
      all: (...args: any[]) => {
        // insight_ids IN (...) — must come before generic candidate check
        if (sql.includes('IN (') && sql.includes("status = 'candidate'")) {
          const ids = args.slice(0, -1) // last arg is cutoff
          const cutoff = args[args.length - 1]
          return Array.from(mockInsights.values()).filter(
            i => ids.includes(i.id) && i.status === 'candidate' && i.created_at <= cutoff,
          )
        }
        // Candidate insights query (no id filter)
        if (sql.includes("status = 'candidate'") && sql.includes('created_at <=')) {
          const cutoff = typeof args[0] === 'number' ? args[0] : Date.now()
          return Array.from(mockInsights.values()).filter(
            i => i.status === 'candidate' && i.created_at <= cutoff,
          )
        }
        // Cluster siblings
        if (sql.includes('cluster_key = ?') && sql.includes('id != ?')) {
          const [clusterKey, excludeId] = args
          return Array.from(mockInsights.values()).filter(
            i => i.cluster_key === clusterKey && i.id !== excludeId,
          )
        }
        // Done tasks
        if (sql.includes("status = 'done'")) {
          return mockTasks.filter(t => t.status === 'done')
        }
        // Active tasks (doing/blocked)
        if (sql.includes("status IN ('doing', 'blocked')") && sql.includes("priority = 'P0'")) {
          return mockTasks.filter(t => ['doing', 'blocked'].includes(t.status) && t.priority === 'P0')
        }
        if (sql.includes("status IN ('doing', 'blocked')")) {
          return mockTasks.filter(t => ['doing', 'blocked'].includes(t.status))
        }
        return []
      },
      run: (..._args: any[]) => {},
    }),
  }),
}))

vi.mock('../src/insight-mutation.js', () => ({
  closeInsightById: (insightId: string, req: { reason: string }) => {
    closedInsights.push({ insightId, reason: req.reason })
    const ins = mockInsights.get(insightId)
    if (ins) ins.status = 'closed'
    return { success: true, insight: { ...ins, status: 'closed' } }
  },
  recordInsightMutation: () => Promise.resolve(),
}))

// ── Import after mocks ──

import { checkGuardrails, buildCandidate, runStaleCandidateReconcileSweep } from '../src/stale-candidate-reconciler.js'
import type { Insight } from '../src/insights.js'

// ── Helpers ──

function makeInsight(overrides: Partial<Insight> & { id: string; cluster_key: string }): any {
  return {
    status: 'candidate',
    score: 7,
    priority: 'P1',
    severity_max: 'medium',
    independent_count: 1,
    created_at: Date.now() - 60 * 60 * 1000, // 1h ago — past MIN_AGE_MS
    updated_at: Date.now(),
    metadata: null,
    ...overrides,
  }
}

function makeTask(
  id: string,
  title: string,
  status: 'done' | 'doing' | 'blocked' | 'todo',
  priority = 'P2',
  meta: Record<string, unknown> = {},
) {
  return { id, title, status, priority, metadata: JSON.stringify(meta) }
}

// ── Tests ──

describe('checkGuardrails', () => {
  beforeEach(() => {
    mockInsights.clear()
    mockTasks.splice(0)
    closedInsights.splice(0)
  })

  it('blocks critical severity', () => {
    const ins = makeInsight({ id: 'ins-test-crit', cluster_key: 'unknown::uncategorized::ios', severity_max: 'critical' })
    const result = checkGuardrails(ins as unknown as Insight, 'unknown::uncategorized::ios')
    expect(result.blocked).toBe(true)
    expect(result.reason).toMatch(/critical/)
  })

  it('blocks high independent_count (≥3)', () => {
    const ins = makeInsight({ id: 'ins-test-multi', cluster_key: 'ios::crash::source-presence', independent_count: 3 })
    const result = checkGuardrails(ins as unknown as Insight, 'ios::crash::source-presence')
    expect(result.blocked).toBe(true)
    expect(result.reason).toMatch(/independent_count=3/)
  })

  it('blocks when a newer candidate exists in same cluster', () => {
    const older = makeInsight({ id: 'ins-old', cluster_key: 'ios::crash::lane', created_at: Date.now() - 2 * 60 * 60 * 1000 })
    const newer = makeInsight({ id: 'ins-new', cluster_key: 'ios::crash::lane', status: 'candidate', created_at: Date.now() - 30 * 60 * 1000 })
    mockInsights.set(older.id, older)
    mockInsights.set(newer.id, newer)

    const result = checkGuardrails(older as unknown as Insight, 'ios::crash::lane')
    expect(result.blocked).toBe(true)
    expect(result.reason).toMatch(/newer candidate/)
  })

  it('passes guardrails for a lone stale medium-severity candidate', () => {
    const ins = makeInsight({ id: 'ins-stale', cluster_key: 'unknown::uncategorized::ios', severity_max: 'medium', independent_count: 1 })
    mockInsights.set(ins.id, ins)
    const result = checkGuardrails(ins as unknown as Insight, 'unknown::uncategorized::ios')
    expect(result.blocked).toBe(false)
  })
})

describe('buildCandidate — ins-1772993714666-qqvx2uxjq style scenario', () => {
  beforeEach(() => {
    mockInsights.clear()
    mockTasks.splice(0)
    closedInsights.splice(0)
  })

  it('marks eligible when done ios tasks + canonical PR exist', () => {
    const ins = makeInsight({
      id: 'ins-1772993714666-qqvx2uxjq',
      cluster_key: 'unknown::uncategorized::ios',
      severity_max: 'medium',
      independent_count: 1,
    })
    mockInsights.set(ins.id, ins)

    mockTasks.push(
      makeTask('task-ios-1', 'iOS: fix source:presence bug', 'done', 'P2', {
        canonical_pr: 'https://github.com/reflectt/reflectt-ios/pull/17',
        canonical_commit: 'abc1234',
      }),
      makeTask('task-ios-2', 'Mobile design QA checklist for first signable iOS build', 'done', 'P1'),
    )

    const candidate = buildCandidate(ins as unknown as Insight)
    expect(candidate.eligible).toBe(true)
    expect(candidate.evidence.doneTasks.length).toBeGreaterThan(0)
    expect(candidate.evidence.mergedPrUrls).toContain('https://github.com/reflectt/reflectt-ios/pull/17')
    expect(candidate.guardrail.blocked).toBe(false)
  })

  it('marks ineligible when no recovery evidence', () => {
    const ins = makeInsight({
      id: 'ins-no-evidence',
      cluster_key: 'unknown::uncategorized::ios',
      severity_max: 'medium',
      independent_count: 1,
    })
    mockInsights.set(ins.id, ins)
    // no done tasks, no actioned sibling insights

    const candidate = buildCandidate(ins as unknown as Insight)
    expect(candidate.eligible).toBe(false)
    expect(candidate.evidence.doneTasks).toHaveLength(0)
  })

  it('marks ineligible when guardrail blocks even with evidence', () => {
    const ins = makeInsight({
      id: 'ins-critical-but-evidence',
      cluster_key: 'unknown::uncategorized::ios',
      severity_max: 'critical', // guardrail blocks
      independent_count: 1,
    })
    mockInsights.set(ins.id, ins)
    mockTasks.push(makeTask('task-ios-done', 'iOS done task', 'done', 'P2'))

    const candidate = buildCandidate(ins as unknown as Insight)
    expect(candidate.eligible).toBe(false)
    expect(candidate.guardrail.blocked).toBe(true)
    expect(candidate.guardrail.reason).toMatch(/critical/)
  })
})

describe('runStaleCandidateReconcileSweep', () => {
  beforeEach(() => {
    mockInsights.clear()
    mockTasks.splice(0)
    closedInsights.splice(0)
  })

  it('dry-run: does not close insights, returns correct counts', () => {
    const ins = makeInsight({
      id: 'ins-dry-test',
      cluster_key: 'unknown::uncategorized::ios',
      severity_max: 'medium',
      independent_count: 1,
    })
    mockInsights.set(ins.id, ins)
    mockTasks.push(makeTask('task-ios-done', 'iOS deep link fix', 'done', 'P2'))

    const result = runStaleCandidateReconcileSweep({ dryRun: true, actor: 'test' })
    expect(result.dryRun).toBe(true)
    expect(result.swept).toBe(1)
    expect(result.eligible).toBe(1)
    expect(result.closed).toBe(1) // dry-run counts eligible as would-be-closed
    expect(closedInsights).toHaveLength(0) // NOT actually closed
    // insight status unchanged
    expect(mockInsights.get('ins-dry-test')?.status).toBe('candidate')
  })

  it('live: closes eligible insights and writes audit metadata', () => {
    const ins = makeInsight({
      id: 'ins-live-test',
      cluster_key: 'unknown::uncategorized::ios',
      severity_max: 'medium',
      independent_count: 1,
    })
    mockInsights.set(ins.id, ins)
    mockTasks.push(
      makeTask('task-ios-done', 'iOS source:presence fix', 'done', 'P2', {
        canonical_pr: 'https://github.com/reflectt/reflectt-ios/pull/23',
      }),
    )

    const result = runStaleCandidateReconcileSweep({ dryRun: false, actor: 'test-runner' })
    expect(result.dryRun).toBe(false)
    expect(result.closed).toBe(1)
    expect(closedInsights).toHaveLength(1)
    expect(closedInsights[0].insightId).toBe('ins-live-test')
    expect(closedInsights[0].reason).toMatch(/stale-candidate-reconciler/)
    expect(mockInsights.get('ins-live-test')?.status).toBe('closed')
  })

  it('does not sweep insights less than 30 min old', () => {
    const freshIns = makeInsight({
      id: 'ins-too-fresh',
      cluster_key: 'unknown::uncategorized::ios',
      created_at: Date.now() - 10 * 60 * 1000, // only 10m old
    })
    mockInsights.set(freshIns.id, freshIns)
    mockTasks.push(makeTask('task-ios', 'iOS fix', 'done'))

    const result = runStaleCandidateReconcileSweep({ dryRun: true })
    expect(result.swept).toBe(0)
  })

  it('restricts sweep to insight_ids when provided', () => {
    const ins1 = makeInsight({ id: 'ins-a', cluster_key: 'ios::a::b' })
    const ins2 = makeInsight({ id: 'ins-b', cluster_key: 'ios::c::d' })
    mockInsights.set(ins1.id, ins1)
    mockInsights.set(ins2.id, ins2)

    const result = runStaleCandidateReconcileSweep({ dryRun: true, insightIds: ['ins-a'] })
    expect(result.swept).toBe(1)
    expect(result.candidates[0].insight.id).toBe('ins-a')
  })

  it('skips non-candidate insights (promoted, closed, etc.)', () => {
    const promoted = makeInsight({ id: 'ins-promoted', cluster_key: 'ios::a::b', status: 'promoted' })
    const closed = makeInsight({ id: 'ins-closed', cluster_key: 'ios::a::b', status: 'closed' })
    mockInsights.set(promoted.id, promoted)
    mockInsights.set(closed.id, closed)

    const result = runStaleCandidateReconcileSweep({ dryRun: true })
    expect(result.swept).toBe(0) // only candidates are swept
  })
})
