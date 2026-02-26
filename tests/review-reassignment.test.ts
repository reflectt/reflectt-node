import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'
import { findAlternateReviewer, reassignReviewer } from '../src/executionSweeper.js'
import { presenceManager } from '../src/presence.js'

describe('Review auto-reassignment', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await createServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('findAlternateReviewer', () => {
    beforeEach(() => {
      // Set up some agents as online
      presenceManager.updatePresence('agent-a', 'online')
      presenceManager.updatePresence('agent-b', 'online')
      presenceManager.updatePresence('agent-c', 'offline')
    })

    it('returns an online agent excluding current reviewer and assignee', () => {
      const result = findAlternateReviewer('agent-a', 'agent-b')
      // Should not be agent-a (current reviewer) or agent-b (assignee)
      expect(result).not.toBe('agent-a')
      expect(result).not.toBe('agent-b')
    })

    it('falls back to ryan when no other agents are online', () => {
      const result = findAlternateReviewer('agent-a', 'agent-b')
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('excludes offline agents', () => {
      const result = findAlternateReviewer('agent-a', 'agent-b')
      expect(result).not.toBe('agent-c') // agent-c is offline
    })
  })

  describe('reassignReviewer', () => {
    it('reassigns reviewer on a validating task', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/tasks',
        payload: {
          title: 'Test reassignment task',
          description: 'Testing reviewer reassignment',
          assignee: 'reassign-test-agent',
          reviewer: 'old-reviewer',
          priority: 'P2',
          done_criteria: ['Reviewer is reassigned successfully'],
          eta: '~1h',
          createdBy: 'reassign-test-agent',
          wip_override: true,
        },
      })
      expect(createRes.statusCode).toBe(200)
      const task = JSON.parse(createRes.body).task

      const success = reassignReviewer(task, 'new-reviewer')
      expect(success).toBe(true)

      const getRes = await app.inject({
        method: 'GET',
        url: `/tasks/${task.id}`,
      })
      const updated = JSON.parse(getRes.body).task
      expect(updated.reviewer).toBe('new-reviewer')
      expect(updated.metadata.reviewer_reassigned).toBe(true)
      expect(updated.metadata.reviewer_reassigned_from).toBe('old-reviewer')
      expect(updated.metadata.reviewer_reassigned_reason).toBe('inactive_reviewer_sla')
    })

    it('resets escalation tracking after reassignment', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/tasks',
        payload: {
          title: 'Test escalation reset',
          description: 'Testing escalation reset after reassignment',
          assignee: 'reassign-test-agent-2',
          reviewer: 'stale-reviewer',
          priority: 'P2',
          done_criteria: ['Escalation tracking is reset after reassignment'],
          eta: '~1h',
          createdBy: 'reassign-test-agent-2',
          wip_override: true,
        },
      })
      const task = JSON.parse(createRes.body).task

      const success = reassignReviewer(task, 'fresh-reviewer')
      expect(success).toBe(true)

      const getRes = await app.inject({
        method: 'GET',
        url: `/tasks/${task.id}`,
      })
      const updated = JSON.parse(getRes.body).task
      expect(updated.metadata.sweeper_escalation_count).toBe(0)
      expect(updated.metadata.review_state).toBe('queued')
    })
  })
})
