// Tests for support tier SLA policy + breach risk computation
import { describe, it, expect, beforeEach } from 'vitest'
import {
  computeBreachRisk,
  computeSLAStatus,
  TIER_POLICIES,
  submitFeedback,
  getTriageQueue,
  listFeedback,
  buildTriageTask,
  _clearFeedbackStore,
  type FeedbackRecord,
  type SupportTier,
} from '../src/feedback.js'

const HOUR = 3_600_000
const DAY = 86_400_000

beforeEach(() => {
  _clearFeedbackStore()
})

describe('computeBreachRisk', () => {
  it('returns none for early timers', () => {
    expect(computeBreachRisk(1 * HOUR, 24 * HOUR)).toBe('none')
    expect(computeBreachRisk(0, 24 * HOUR)).toBe('none')
  })

  it('returns approaching at 50%', () => {
    expect(computeBreachRisk(12 * HOUR, 24 * HOUR)).toBe('approaching')
  })

  it('returns at_risk at 75%', () => {
    expect(computeBreachRisk(18 * HOUR, 24 * HOUR)).toBe('at_risk')
  })

  it('returns breached at 100%', () => {
    expect(computeBreachRisk(24 * HOUR, 24 * HOUR)).toBe('breached')
    expect(computeBreachRisk(48 * HOUR, 24 * HOUR)).toBe('breached')
  })

  it('returns none for zero SLA (no-op)', () => {
    expect(computeBreachRisk(5000, 0)).toBe('none')
  })
})

describe('TIER_POLICIES', () => {
  it('has all three tiers', () => {
    expect(Object.keys(TIER_POLICIES)).toEqual(['free', 'pro', 'team'])
  })

  it('team has tightest SLAs', () => {
    expect(TIER_POLICIES.team.responseSlaMs).toBeLessThan(TIER_POLICIES.pro.responseSlaMs)
    expect(TIER_POLICIES.pro.responseSlaMs).toBeLessThan(TIER_POLICIES.free.responseSlaMs)
  })

  it('team has highest priority boost', () => {
    expect(TIER_POLICIES.team.priorityBoost).toBeGreaterThan(TIER_POLICIES.pro.priorityBoost)
    expect(TIER_POLICIES.pro.priorityBoost).toBeGreaterThan(TIER_POLICIES.free.priorityBoost)
  })
})

describe('computeSLAStatus', () => {
  it('computes SLA for a new free-tier record', () => {
    const record = submitFeedback({
      category: 'bug',
      message: 'Something is broken badly',
      siteToken: 'test',
      timestamp: Date.now(),
    })
    const now = record.createdAt + 10 * HOUR
    const sla = computeSLAStatus(record, now)

    expect(sla.tier).toBe('free')
    expect(sla.responseSlaMs).toBe(72 * HOUR)
    expect(sla.resolutionSlaMs).toBe(14 * DAY)
    expect(sla.responseElapsedMs).toBe(10 * HOUR)
    expect(sla.responseBreachRisk).toBe('none') // 10/72 = 13.9%
  })

  it('shows breached for team tier with slow response', () => {
    const record = submitFeedback({
      category: 'bug',
      message: 'Production is down completely',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'team',
    })
    const now = record.createdAt + 5 * HOUR  // > 4h SLA
    const sla = computeSLAStatus(record, now)

    expect(sla.tier).toBe('team')
    expect(sla.responseBreachRisk).toBe('breached')
  })

  it('freezes response SLA when responded', () => {
    const record = submitFeedback({
      category: 'bug',
      message: 'Something is broken badly',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'pro',
    })
    // Respond at 2 hours
    record.respondedAt = record.createdAt + 2 * HOUR
    
    // Check at 48 hours — response should still show 2h elapsed, not 48h
    const sla = computeSLAStatus(record, record.createdAt + 48 * HOUR)
    expect(sla.responseElapsedMs).toBe(2 * HOUR)
    expect(sla.responseBreachRisk).toBe('none') // 2/24 = 8.3%
    expect(sla.respondedAt).toBe(record.respondedAt)
  })

  it('triaged records have no resolution breach risk', () => {
    const record = submitFeedback({
      category: 'bug',
      message: 'Something is broken badly',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'team',
    })
    record.status = 'triaged'
    
    // Even at 100 days, triaged = no resolution risk
    const sla = computeSLAStatus(record, record.createdAt + 100 * DAY)
    expect(sla.resolutionBreachRisk).toBe('none')
  })
})

describe('getTriageQueue with SLA', () => {
  it('sorts breached items first', () => {
    // Old team-tier item (breached)
    const old = submitFeedback({
      category: 'bug',
      message: 'Old team item that is very broken',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'team',
      severity: 'medium',
    })
    // Backdate it to 5 hours ago (breaches 4h team SLA)
    ;(old as any).createdAt = Date.now() - 5 * HOUR

    // New free-tier item
    submitFeedback({
      category: 'bug',
      message: 'New free item that just came in now',
      siteToken: 'test',
      timestamp: Date.now(),
      severity: 'critical',
    })

    const queue = getTriageQueue()
    expect(queue.items.length).toBe(2)
    expect(queue.breachedCount).toBe(1)
    // Breached team item should be first despite lower severity
    expect(queue.items[0].feedbackId).toBe(old.id)
    expect(queue.items[0].sla.overallBreachRisk).toBe('breached')
    expect(queue.items[0].tier).toBe('team')
  })

  it('applies priority boost for paid tiers', () => {
    // Team tier medium bug → P2 base, boost 2 → P0
    submitFeedback({
      category: 'bug',
      message: 'Team medium severity bug report',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'team',
      severity: 'medium',
    })

    const queue = getTriageQueue()
    expect(queue.items[0].suggestedPriority).toBe('P0') // P2 - 2 = P0
  })

  it('does not boost free tier', () => {
    submitFeedback({
      category: 'bug',
      message: 'Free tier medium severity bug',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'free',
      severity: 'medium',
    })

    const queue = getTriageQueue()
    expect(queue.items[0].suggestedPriority).toBe('P2')
  })

  it('includes atRiskCount', () => {
    const record = submitFeedback({
      category: 'bug',
      message: 'Pro tier approaching SLA limit',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'pro',
    })
    // 20 hours into 24h SLA = 83% = at_risk
    ;(record as any).createdAt = Date.now() - 20 * HOUR

    const queue = getTriageQueue()
    expect(queue.atRiskCount).toBe(1)
  })
})

describe('listFeedback with SLA', () => {
  it('includes tier and SLA in list items', () => {
    submitFeedback({
      category: 'bug',
      message: 'Test feedback for listing view',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'pro',
    })

    const result = listFeedback({ status: 'new' })
    expect(result.items[0].tier).toBe('pro')
    expect(result.items[0].sla).toBeDefined()
    expect(result.items[0].sla.tier).toBe('pro')
    expect(result.items[0].sla.responseSlaMs).toBe(24 * HOUR)
  })

  it('filters by tier', () => {
    submitFeedback({ category: 'bug', message: 'Free tier bug feedback entry', siteToken: 'test', timestamp: Date.now(), tier: 'free' })
    submitFeedback({ category: 'bug', message: 'Pro tier bug feedback entry here', siteToken: 'test', timestamp: Date.now(), tier: 'pro' })

    const proOnly = listFeedback({ status: 'new', tier: 'pro' })
    expect(proOnly.items.length).toBe(1)
    expect(proOnly.items[0].tier).toBe('pro')
  })

  it('sorts by breach_risk', () => {
    const breached = submitFeedback({
      category: 'bug',
      message: 'Team tier item that is very old now',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'team',
    })
    ;(breached as any).createdAt = Date.now() - 10 * HOUR // breached (>4h)

    submitFeedback({
      category: 'bug',
      message: 'Fresh free tier feedback just came in',
      siteToken: 'test',
      timestamp: Date.now(),
    })

    const result = listFeedback({ status: 'new', sort: 'breach_risk' })
    expect(result.items[0].sla.overallBreachRisk).toBe('breached')
    expect(result.breachedCount).toBe(1)
  })

  it('defaults tier to free when not provided', () => {
    submitFeedback({
      category: 'feature',
      message: 'No tier specified in this request',
      siteToken: 'test',
      timestamp: Date.now(),
    })

    const result = listFeedback({ status: 'new' })
    expect(result.items[0].tier).toBe('free')
  })
})

describe('buildTriageTask with tier', () => {
  it('includes tier and SLA snapshot in task metadata', () => {
    submitFeedback({
      category: 'bug',
      message: 'Pro tier critical bug in production',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'pro',
      severity: 'critical',
    })

    const queue = getTriageQueue()
    const result = buildTriageTask({
      feedbackId: queue.items[0].feedbackId,
      triageAgent: 'sage',
    })

    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.metadata.tier).toBe('pro')
      expect(result.metadata.slaAtTriage).toBeDefined()
      expect(result.metadata.slaAtTriage.responseBreachRisk).toBeDefined()
      // Pro critical → P0 base, boost 1 → still P0
      expect(result.priority).toBe('P0')
    }
  })

  it('boosts priority for team tier', () => {
    submitFeedback({
      category: 'feature',
      message: 'Team tier feature request for dashboard',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'team',
    })

    const queue = getTriageQueue()
    const result = buildTriageTask({
      feedbackId: queue.items[0].feedbackId,
      triageAgent: 'sage',
    })

    if (!('error' in result)) {
      // Feature = low = P3, team boost = 2 → P1
      expect(result.priority).toBe('P1')
      expect(result.title).toContain('[TEAM]')
    }
  })

  it('includes SLA risk warning in description', () => {
    const record = submitFeedback({
      category: 'bug',
      message: 'Team tier bug that has been waiting very long',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'team',
    })
    ;(record as any).createdAt = Date.now() - 5 * HOUR

    const result = buildTriageTask({
      feedbackId: record.id,
      triageAgent: 'sage',
    })

    if (!('error' in result)) {
      expect(result.description).toContain('SLA Risk')
    }
  })
})
