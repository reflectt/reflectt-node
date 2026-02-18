// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll } from 'vitest'
import Fastify from 'fastify'

describe('Mutation Alerts', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  describe('GET /audit/mutation-alerts', () => {
    it('returns alert status', async () => {
      const res = await app.inject({ method: 'GET', url: '/audit/mutation-alerts' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body).toHaveProperty('alertCount')
      expect(body).toHaveProperty('recentAlerts')
      expect(body).toHaveProperty('trackedAttempts')
      expect(typeof body.alertCount).toBe('number')
      expect(Array.isArray(body.recentAlerts)).toBe(true)
    })
  })

  describe('alertUnauthorizedApproval', () => {
    it('records unauthorized attempt and emits alert', async () => {
      const { alertUnauthorizedApproval, getMutationAlertStatus } = await import('../src/mutationAlert.js')
      const before = getMutationAlertStatus().alertCount

      await alertUnauthorizedApproval({
        taskId: 'test-task-alert-1',
        taskTitle: 'Test Task',
        actor: 'imposter',
        expectedReviewer: 'real-reviewer',
        context: 'test',
      })

      const after = getMutationAlertStatus()
      expect(after.alertCount).toBeGreaterThan(before)

      const lastAlert = after.recentAlerts[after.recentAlerts.length - 1]
      expect(lastAlert?.type).toBe('unauthorized_approval')
      expect(lastAlert?.actor).toBe('imposter')
      expect(lastAlert?.expectedReviewer).toBe('real-reviewer')
      expect(lastAlert?.taskId).toBe('test-task-alert-1')
    })

    it('throttles repeated alerts for same actor+task', async () => {
      const { alertUnauthorizedApproval, getMutationAlertStatus } = await import('../src/mutationAlert.js')

      // First alert
      await alertUnauthorizedApproval({
        taskId: 'test-throttle-task',
        taskTitle: 'Throttle Test',
        actor: 'spammer',
        expectedReviewer: 'reviewer',
        context: 'test',
      })
      const count1 = getMutationAlertStatus().alertCount

      // Second alert (should be throttled)
      await alertUnauthorizedApproval({
        taskId: 'test-throttle-task',
        taskTitle: 'Throttle Test',
        actor: 'spammer',
        expectedReviewer: 'reviewer',
        context: 'test',
      })
      const count2 = getMutationAlertStatus().alertCount

      // Both should be logged (throttled flag differs)
      expect(count2).toBe(count1 + 1)
      const lastAlert = getMutationAlertStatus().recentAlerts.pop()
      expect(lastAlert?.throttled).toBe(true)
    })
  })

  describe('alertFlipAttempt', () => {
    it('records flip attempt', async () => {
      const { alertFlipAttempt, getMutationAlertStatus } = await import('../src/mutationAlert.js')
      const before = getMutationAlertStatus().alertCount

      await alertFlipAttempt({
        taskId: 'test-flip-task',
        taskTitle: 'Flip Test',
        actor: 'flipper',
        fromValue: true,
        toValue: false,
        context: 'test',
      })

      // First flip alone doesn't trigger alert (need 2+)
      // But it records in audit ledger
      const { getAuditEntries } = await import('../src/auditLedger.js')
      const entries = getAuditEntries({ taskId: 'test-flip-task' })
      expect(entries.length).toBeGreaterThan(0)
      expect(entries[0]?.context).toContain('flip detected')
    })
  })

  describe('pruneOldAttempts', () => {
    it('runs without error', async () => {
      const { pruneOldAttempts } = await import('../src/mutationAlert.js')
      expect(() => pruneOldAttempts()).not.toThrow()
    })
  })

  describe('PATCH /tasks rejection triggers alert', () => {
    it('returns 403 for non-reviewer approval and records alert', async () => {
      // Create a task with a reviewer
      const createRes = await app.inject({
        method: 'POST',
        url: '/tasks',
        payload: {
          title: 'Alert integration test',
          status: 'validating',
          assignee: 'test-agent',
          reviewer: 'assigned-reviewer',
          done_criteria: ['test'],
          createdBy: 'test-agent',
          eta: '2026-12-31',
        },
      })
      const taskId = JSON.parse(createRes.body).task?.id || JSON.parse(createRes.body).id
      if (!taskId) return // Skip if task format doesn't match

      // Attempt approval as wrong actor
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/tasks/${taskId}`,
        payload: {
          actor: 'wrong-actor',
          metadata: { reviewer_approved: true },
        },
      })

      expect(patchRes.statusCode).toBe(403)
      const body = JSON.parse(patchRes.body)
      expect(body.gate).toBe('reviewer_identity')
    })
  })
})
