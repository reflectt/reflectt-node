import { describe, it, expect, beforeEach } from 'vitest'
import {
  emitActivationEvent,
  getUserFunnelState,
  getFunnelSummary,
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

  it('tracks all 6 events and marks funnel complete', async () => {
    const events = [
      'signup_completed',
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
    expect(state.currentStep).toBe(6)
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
