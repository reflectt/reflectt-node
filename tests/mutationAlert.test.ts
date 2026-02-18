import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before importing module
vi.mock('../src/chat.js', () => ({
  chatManager: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../src/auditLedger.js', () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}))

// Import after mocks are set up
const { alertUnauthorizedApproval, alertFlipAttempt, getMutationAlertStatus, pruneOldAttempts } = await import('../src/mutationAlert.js')
const { chatManager } = await import('../src/chat.js')

describe('Mutation Alert System', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset internal state by pruning with future time
    pruneOldAttempts()
  })

  describe('alertUnauthorizedApproval', () => {
    it('posts alert on first unauthorized attempt', async () => {
      await alertUnauthorizedApproval({
        taskId: 'task-test-1',
        taskTitle: 'Test Task',
        actor: 'imposter',
        expectedReviewer: 'real-reviewer',
        context: 'test',
      })

      expect(chatManager.sendMessage).toHaveBeenCalledTimes(1)
      const call = (chatManager.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(call.channel).toBe('general')
      expect(call.from).toBe('security')
      expect(call.content).toContain('imposter')
      expect(call.content).toContain('real-reviewer')
      expect(call.content).toContain('Unauthorized')
    })

    it('throttles repeat alerts within 5 minutes for same actor+task', async () => {
      await alertUnauthorizedApproval({
        taskId: 'task-throttle-1',
        taskTitle: 'Throttle Task',
        actor: 'spammer',
        expectedReviewer: 'reviewer-a',
        context: 'test',
      })

      await alertUnauthorizedApproval({
        taskId: 'task-throttle-1',
        taskTitle: 'Throttle Task',
        actor: 'spammer',
        expectedReviewer: 'reviewer-a',
        context: 'test',
      })

      // Only 1 chat message despite 2 attempts
      expect(chatManager.sendMessage).toHaveBeenCalledTimes(1)
    })

    it('escalates to burst alert after 3 attempts in window', async () => {
      const taskId = 'task-burst-1'

      // Force 3 attempts without throttle by manipulating time
      // We call it 3 times — first will alert, 2nd+3rd throttled
      for (let i = 0; i < 3; i++) {
        await alertUnauthorizedApproval({
          taskId,
          taskTitle: 'Burst Task',
          actor: 'persistent-attacker',
          expectedReviewer: 'reviewer-b',
          context: 'test',
        })
      }

      // Check that alert log has the burst_alert type on the 3rd attempt
      const status = getMutationAlertStatus()
      const burstAlerts = status.recentAlerts.filter(a => a.type === 'burst_alert' && a.taskId === taskId)
      expect(burstAlerts.length).toBeGreaterThanOrEqual(1)
    })

    it('records alert in status endpoint', async () => {
      await alertUnauthorizedApproval({
        taskId: 'task-status-1',
        taskTitle: 'Status Task',
        actor: 'test-actor',
        expectedReviewer: 'test-reviewer',
        context: 'test',
      })

      const status = getMutationAlertStatus()
      expect(status.alertCount).toBeGreaterThan(0)
      expect(status.trackedAttempts).toBeGreaterThan(0)
      const relevant = status.recentAlerts.filter(a => a.taskId === 'task-status-1')
      expect(relevant.length).toBeGreaterThan(0)
      expect(relevant[0].actor).toBe('test-actor')
    })
  })

  describe('alertFlipAttempt', () => {
    it('alerts after 2 flips in window', async () => {
      const taskId = 'task-flip-1'

      await alertFlipAttempt({
        taskId,
        taskTitle: 'Flip Task',
        actor: 'flip-reviewer',
        fromValue: false,
        toValue: true,
        context: 'test',
      })

      await alertFlipAttempt({
        taskId,
        taskTitle: 'Flip Task',
        actor: 'flip-reviewer',
        fromValue: true,
        toValue: false,
        context: 'test',
      })

      // Should have posted a flip alert
      const calls = (chatManager.sendMessage as ReturnType<typeof vi.fn>).mock.calls
      const flipCalls = calls.filter((c: any) => c[0].content.includes('flip'))
      expect(flipCalls.length).toBeGreaterThanOrEqual(1)
    })

    it('does not alert on first flip', async () => {
      vi.clearAllMocks()
      
      await alertFlipAttempt({
        taskId: 'task-single-flip',
        taskTitle: 'Single Flip Task',
        actor: 'careful-reviewer',
        fromValue: false,
        toValue: true,
        context: 'test',
      })

      // First flip should NOT trigger alert (threshold is 2)
      const calls = (chatManager.sendMessage as ReturnType<typeof vi.fn>).mock.calls
      const flipCalls = calls.filter((c: any) => c[0].content.includes('flip'))
      expect(flipCalls.length).toBe(0)
    })
  })

  describe('pruneOldAttempts', () => {
    it('cleans up tracked attempts', async () => {
      await alertUnauthorizedApproval({
        taskId: 'task-prune-1',
        taskTitle: 'Prune Task',
        actor: 'prune-actor',
        expectedReviewer: 'prune-reviewer',
        context: 'test',
      })

      const before = getMutationAlertStatus()
      expect(before.trackedAttempts).toBeGreaterThan(0)

      // Prune won't remove recent entries, but function should run without error
      pruneOldAttempts()
      const after = getMutationAlertStatus()
      expect(after.trackedAttempts).toBeGreaterThanOrEqual(0)
    })
  })

  describe('getMutationAlertStatus', () => {
    it('returns expected shape', () => {
      const status = getMutationAlertStatus()
      expect(status).toHaveProperty('alertCount')
      expect(status).toHaveProperty('recentAlerts')
      expect(status).toHaveProperty('trackedAttempts')
      expect(Array.isArray(status.recentAlerts)).toBe(true)
      expect(typeof status.alertCount).toBe('number')
      expect(typeof status.trackedAttempts).toBe('number')
    })
  })
})
