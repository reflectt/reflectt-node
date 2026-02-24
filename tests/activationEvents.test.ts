import { describe, it, expect, beforeEach } from 'vitest'
import {
  emitActivationEvent,
  getUserFunnelState,
  getFunnelSummary,
  getConversionFunnel,
  getFailureDistribution,
  getWeeklyTrends,
  getOnboardingDashboard,
  hasCompletedEvent,
  isDay2Eligible,
  getSignupTimestamp,
  resetActivationFunnel,
} from '../src/activationEvents.js'

describe('Activation Funnel Events', () => {
  beforeEach(() => {
    resetActivationFunnel()
  })

  it('emits signup_completed and records timestamp', async () => {
    const isNew = await emitActivationEvent('signup_completed', 'user-1')
    expect(isNew).toBe(true)

    const state = getUserFunnelState('user-1')
    expect(state.events.signup_completed).toBeTypeOf('number')
    expect(state.currentStep).toBe(1)
  })

  it('is idempotent — second emit returns false', async () => {
    await emitActivationEvent('signup_completed', 'user-1')
    const isNew = await emitActivationEvent('signup_completed', 'user-1')
    expect(isNew).toBe(false)

    const state = getUserFunnelState('user-1')
    expect(state.currentStep).toBe(1)
  })

  it('tracks all events and marks funnel complete', async () => {
    const events = [
      'signup_completed',
      'host_preflight_passed',
      'host_preflight_failed',
      'workspace_ready',
      'first_task_started',
      'first_task_completed',
      'first_team_message_sent',
      'day2_return_action',
    ] as const

    for (const type of events) {
      await emitActivationEvent(type, 'user-1')
    }

    const state = getUserFunnelState('user-1')
    expect(state.currentStep).toBe(7)
    expect(state.completedAt).toBeTypeOf('number')
    for (const type of events) {
      expect(state.events[type]).toBeTypeOf('number')
    }
  })

  it('hasCompletedEvent returns correct values', async () => {
    expect(hasCompletedEvent('user-1', 'signup_completed')).toBe(false)
    await emitActivationEvent('signup_completed', 'user-1')
    expect(hasCompletedEvent('user-1', 'signup_completed')).toBe(true)
    expect(hasCompletedEvent('user-1', 'workspace_ready')).toBe(false)
  })

  it('getSignupTimestamp returns null for unknown user', () => {
    expect(getSignupTimestamp('unknown')).toBeNull()
  })

  it('getSignupTimestamp returns timestamp after signup', async () => {
    await emitActivationEvent('signup_completed', 'user-1')
    const ts = getSignupTimestamp('user-1')
    expect(ts).toBeTypeOf('number')
    expect(ts!).toBeGreaterThan(0)
  })

  it('isDay2Eligible returns false before signup', () => {
    expect(isDay2Eligible('user-1')).toBe(false)
  })

  it('isDay2Eligible returns false immediately after signup', async () => {
    await emitActivationEvent('signup_completed', 'user-1')
    expect(isDay2Eligible('user-1')).toBe(false)
  })

  it('getFunnelSummary aggregates across users', async () => {
    await emitActivationEvent('signup_completed', 'user-1')
    await emitActivationEvent('signup_completed', 'user-2')
    await emitActivationEvent('workspace_ready', 'user-1')

    const summary = getFunnelSummary()
    expect(summary.totalUsers).toBe(2)
    expect(summary.stepCounts.signup_completed).toBe(2)
    expect(summary.stepCounts.workspace_ready).toBe(1)
    expect(summary.completedUsers).toBe(0)
    expect(summary.funnelByUser).toHaveLength(2)
  })

  it('returns empty state for unknown user', () => {
    const state = getUserFunnelState('nonexistent')
    expect(state.userId).toBe('nonexistent')
    expect(state.currentStep).toBe(0)
    expect(state.completedAt).toBeNull()
    for (const val of Object.values(state.events)) {
      expect(val).toBeNull()
    }
  })

  it('rejects empty userId', async () => {
    const isNew = await emitActivationEvent('signup_completed', '')
    expect(isNew).toBe(false)
  })

  it('stores metadata with events', async () => {
    await emitActivationEvent('first_task_started', 'user-1', { taskId: 'task-123' })
    expect(hasCompletedEvent('user-1', 'first_task_started')).toBe(true)
  })
})

// ── Dashboard / Telemetry Tests ──

describe('Onboarding Telemetry Dashboard', () => {
  beforeEach(() => {
    resetActivationFunnel()
  })

  describe('getConversionFunnel', () => {
    it('returns empty funnel with no users', () => {
      const funnel = getConversionFunnel()
      expect(funnel.length).toBe(7)
      for (const step of funnel) {
        expect(step.reached).toBe(0)
        expect(step.conversionRate).toBe(0)
      }
    })

    it('computes conversion rates between steps', async () => {
      // 3 users sign up, 2 pass preflight, 1 reaches workspace_ready
      await emitActivationEvent('signup_completed', 'u1')
      await emitActivationEvent('signup_completed', 'u2')
      await emitActivationEvent('signup_completed', 'u3')
      await emitActivationEvent('host_preflight_passed', 'u1')
      await emitActivationEvent('host_preflight_passed', 'u2')
      await emitActivationEvent('workspace_ready', 'u1')

      const funnel = getConversionFunnel()
      const signup = funnel.find(s => s.step === 'signup_completed')!
      const preflight = funnel.find(s => s.step === 'host_preflight_passed')!
      const workspace = funnel.find(s => s.step === 'workspace_ready')!

      expect(signup.reached).toBe(3)
      expect(preflight.reached).toBe(2)
      expect(workspace.reached).toBe(1)

      // Conversion from signup → preflight = 2/3
      expect(preflight.conversionRate).toBeCloseTo(2 / 3, 2)
      // Conversion from preflight → (preflight_failed, which nobody hit) then workspace
      expect(workspace.reached).toBe(1)
    })

    it('computes median step time', async () => {
      await emitActivationEvent('signup_completed', 'u1')
      // Small delay to have measurable time
      await new Promise(r => setTimeout(r, 10))
      await emitActivationEvent('host_preflight_passed', 'u1')

      const funnel = getConversionFunnel()
      const preflight = funnel.find(s => s.step === 'host_preflight_passed')!
      expect(preflight.medianTimeMs).toBeTypeOf('number')
      expect(preflight.medianTimeMs!).toBeGreaterThanOrEqual(0)
    })
  })

  describe('getFailureDistribution', () => {
    it('returns zero drops with no users', () => {
      const dist = getFailureDistribution()
      expect(dist.length).toBe(7)
      for (const step of dist) {
        expect(step.droppedCount).toBe(0)
      }
    })

    it('detects drop-offs between steps', async () => {
      await emitActivationEvent('signup_completed', 'u1')
      await emitActivationEvent('signup_completed', 'u2')
      await emitActivationEvent('host_preflight_passed', 'u1')
      // u2 drops off at preflight

      const dist = getFailureDistribution()
      const preflightDrop = dist.find(s => s.step === 'host_preflight_passed')!
      expect(preflightDrop.droppedCount).toBe(1) // u2 dropped
    })

    it('captures failure reasons from event metadata', async () => {
      await emitActivationEvent('signup_completed', 'u1')
      // u1 fails preflight with specific reasons
      await emitActivationEvent('host_preflight_failed', 'u1', {
        failed_checks: ['cloud-reachable', 'auth-valid'],
        first_blocker: 'cloud-reachable',
      })

      const dist = getFailureDistribution()
      const preflightDrop = dist.find(s => s.step === 'host_preflight_passed')!
      expect(preflightDrop.droppedCount).toBe(1)
      expect(preflightDrop.reasons.some(r => r.reason === 'cloud-reachable')).toBe(true)
    })
  })

  describe('getWeeklyTrends', () => {
    it('returns requested number of weeks', () => {
      const trends = getWeeklyTrends(4)
      expect(trends.length).toBe(4)
      for (const week of trends) {
        expect(week.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(week.weekEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(typeof week.newUsers).toBe('number')
        expect(typeof week.completedUsers).toBe('number')
        expect(typeof week.conversionRate).toBe('number')
      }
    })

    it('counts current-week events in last bucket', async () => {
      await emitActivationEvent('signup_completed', 'u-trend-1')

      // Use 2 weeks to ensure the current moment falls within the last bucket
      // (weekCount=1 can miss due to Monday-alignment edge cases)
      const trends = getWeeklyTrends(2)
      expect(trends.length).toBe(2)
      // Last bucket should include the signup we just emitted
      const lastBucket = trends[trends.length - 1]
      expect(lastBucket.newUsers).toBeGreaterThanOrEqual(1)
      expect(lastBucket.stepCounts.signup_completed).toBeGreaterThanOrEqual(1)
    })
  })

  describe('getOnboardingDashboard', () => {
    it('returns complete dashboard snapshot', async () => {
      await emitActivationEvent('signup_completed', 'u-dash-1')

      const dashboard = getOnboardingDashboard()
      expect(dashboard.timestamp).toBeGreaterThan(0)
      expect(dashboard.funnel).toBeInstanceOf(Array)
      expect(dashboard.failures).toBeInstanceOf(Array)
      expect(dashboard.trends).toBeInstanceOf(Array)
      expect(dashboard.summary).toBeDefined()
      expect(dashboard.summary.totalUsers).toBe(1)
    })

    it('respects weeks option', () => {
      const dashboard = getOnboardingDashboard({ weeks: 4 })
      expect(dashboard.trends.length).toBe(4)
    })
  })
})
