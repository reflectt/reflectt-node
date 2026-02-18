import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  emitActivationEvent,
  getUserFunnelState,
  getFunnelSummary,
  hasCompletedEvent,
  isDay2Eligible,
  resetActivationFunnel,
} = await import('../src/activationEvents.js')

describe('Activation Funnel Events', () => {
  beforeEach(() => {
    resetActivationFunnel()
  })

  it('records signup_completed event', async () => {
    const isNew = await emitActivationEvent('signup_completed', 'test-user')
    expect(isNew).toBe(true)
    const state = getUserFunnelState('test-user')
    expect(state.events.signup_completed).not.toBeNull()
    expect(state.currentStep).toBeGreaterThanOrEqual(1)
  })

  it('is idempotent — duplicate events return false', async () => {
    await emitActivationEvent('signup_completed', 'test-user')
    const isNew = await emitActivationEvent('signup_completed', 'test-user')
    expect(isNew).toBe(false)
  })

  it('tracks sequential steps', async () => {
    await emitActivationEvent('signup_completed', 'test-user')
    await emitActivationEvent('workspace_ready', 'test-user')
    await emitActivationEvent('first_task_started', 'test-user')
    const state = getUserFunnelState('test-user')
    expect(state.currentStep).toBe(3)
  })

  it('hasCompletedEvent returns true for recorded events', async () => {
    await emitActivationEvent('signup_completed', 'test-user')
    expect(hasCompletedEvent('test-user', 'signup_completed')).toBe(true)
    expect(hasCompletedEvent('test-user', 'workspace_ready')).toBe(false)
  })

  it('records all 6 events and marks complete', async () => {
    const events = [
      'signup_completed', 'workspace_ready', 'first_task_started',
      'first_task_completed', 'first_team_message_sent', 'day2_return_action',
    ] as const
    for (const e of events) {
      await emitActivationEvent(e, 'test-user')
    }
    const state = getUserFunnelState('test-user')
    expect(state.currentStep).toBe(6)
    expect(state.completedAt).not.toBeNull()
  })

  it('getUserFunnelState returns empty state for unknown user', () => {
    const state = getUserFunnelState('ghost')
    expect(state.currentStep).toBe(0)
    expect(state.completedAt).toBeNull()
  })

  it('getFunnelSummary aggregates across users', async () => {
    await emitActivationEvent('signup_completed', 'user-a')
    await emitActivationEvent('signup_completed', 'user-b')
    await emitActivationEvent('workspace_ready', 'user-a')

    const summary = getFunnelSummary()
    expect(summary.totalUsers).toBe(2)
    expect(summary.stepCounts.signup_completed).toBe(2)
    expect(summary.stepCounts.workspace_ready).toBe(1)
  })

  it('isDay2Eligible returns false for fresh signup', async () => {
    await emitActivationEvent('signup_completed', 'new-user')
    expect(isDay2Eligible('new-user')).toBe(false)
  })

  it('isDay2Eligible returns false for unknown user', () => {
    expect(isDay2Eligible('nobody')).toBe(false)
  })

  it('resetActivationFunnel clears all data', async () => {
    await emitActivationEvent('signup_completed', 'test-user')
    resetActivationFunnel()
    const state = getUserFunnelState('test-user')
    expect(state.currentStep).toBe(0)
  })
})
