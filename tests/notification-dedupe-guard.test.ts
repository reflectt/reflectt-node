// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from 'vitest'
import {
  shouldEmitNotification,
  clearDedupeState,
  getDedupeState,
  pruneDedupeState,
} from '../src/notificationDedupeGuard.js'

describe('notificationDedupeGuard', () => {
  beforeEach(() => {
    clearDedupeState()
  })

  describe('monotonic cursor (Guard 1)', () => {
    it('emits first event for a task', () => {
      const result = shouldEmitNotification({
        taskId: 'task-1',
        eventUpdatedAt: 1000,
        eventStatus: 'doing',
      })
      expect(result.emit).toBe(true)
    })

    it('emits when updatedAt is strictly greater than lastSeen', () => {
      shouldEmitNotification({ taskId: 'task-1', eventUpdatedAt: 1000, eventStatus: 'doing' })

      const result = shouldEmitNotification({
        taskId: 'task-1',
        eventUpdatedAt: 2000,
        eventStatus: 'validating',
      })
      expect(result.emit).toBe(true)
    })

    it('drops event when updatedAt equals lastSeen', () => {
      shouldEmitNotification({ taskId: 'task-1', eventUpdatedAt: 1000, eventStatus: 'doing' })

      const result = shouldEmitNotification({
        taskId: 'task-1',
        eventUpdatedAt: 1000,
        eventStatus: 'doing',
      })
      expect(result.emit).toBe(false)
      expect(result.reason).toContain('Stale event')
    })

    it('drops event when updatedAt is less than lastSeen', () => {
      shouldEmitNotification({ taskId: 'task-1', eventUpdatedAt: 2000, eventStatus: 'validating' })

      const result = shouldEmitNotification({
        taskId: 'task-1',
        eventUpdatedAt: 1000,
        eventStatus: 'doing',
      })
      expect(result.emit).toBe(false)
      expect(result.reason).toContain('Stale event')
    })

    it('tracks separate cursors per task', () => {
      shouldEmitNotification({ taskId: 'task-1', eventUpdatedAt: 1000, eventStatus: 'doing' })
      shouldEmitNotification({ taskId: 'task-2', eventUpdatedAt: 500, eventStatus: 'doing' })

      // task-2 at 600 should emit (> 500)
      const r1 = shouldEmitNotification({ taskId: 'task-2', eventUpdatedAt: 600, eventStatus: 'validating' })
      expect(r1.emit).toBe(true)

      // task-1 at 999 should NOT emit (< 1000)
      const r2 = shouldEmitNotification({ taskId: 'task-1', eventUpdatedAt: 999, eventStatus: 'validating' })
      expect(r2.emit).toBe(false)
    })
  })

  describe('contradictory transition (Guard 2)', () => {
    it('suppresses event when task is further along in lifecycle', () => {
      const result = shouldEmitNotification({
        taskId: 'task-3',
        eventUpdatedAt: 1000,
        eventStatus: 'doing',
        currentTaskStatus: 'done',
        currentTaskUpdatedAt: 2000,
      })
      expect(result.emit).toBe(false)
      expect(result.reason).toContain('Contradictory')
    })

    it('allows event when task status matches', () => {
      const result = shouldEmitNotification({
        taskId: 'task-4',
        eventUpdatedAt: 1000,
        eventStatus: 'doing',
        currentTaskStatus: 'doing',
        currentTaskUpdatedAt: 1000,
      })
      expect(result.emit).toBe(true)
    })

    it('allows event when task is behind the event', () => {
      const result = shouldEmitNotification({
        taskId: 'task-5',
        eventUpdatedAt: 2000,
        eventStatus: 'validating',
        currentTaskStatus: 'doing',
        currentTaskUpdatedAt: 1000,
      })
      expect(result.emit).toBe(true)
    })
  })

  describe('replayed out-of-order events', () => {
    it('emits only the newest event in a replay sequence', () => {
      // Simulate out-of-order: doing(1000), done(3000), validating(2000)
      const r1 = shouldEmitNotification({ taskId: 'task-replay', eventUpdatedAt: 1000, eventStatus: 'doing' })
      expect(r1.emit).toBe(true)

      const r2 = shouldEmitNotification({ taskId: 'task-replay', eventUpdatedAt: 3000, eventStatus: 'done' })
      expect(r2.emit).toBe(true)

      // Out of order: validating at 2000 should be dropped (2000 < 3000)
      const r3 = shouldEmitNotification({ taskId: 'task-replay', eventUpdatedAt: 2000, eventStatus: 'validating' })
      expect(r3.emit).toBe(false)
    })
  })

  describe('cursor management', () => {
    it('getDedupeState returns current cursors', () => {
      shouldEmitNotification({ taskId: 'task-a', eventUpdatedAt: 100, eventStatus: 'doing' })
      shouldEmitNotification({ taskId: 'task-b', eventUpdatedAt: 200, eventStatus: 'todo' })

      const state = getDedupeState()
      expect(state.size).toBe(2)
      expect(state.cursors['task-a']).toBe(100)
      expect(state.cursors['task-b']).toBe(200)
    })

    it('clearDedupeState resets all cursors', () => {
      shouldEmitNotification({ taskId: 'task-c', eventUpdatedAt: 100, eventStatus: 'doing' })
      clearDedupeState()

      const state = getDedupeState()
      expect(state.size).toBe(0)

      // Should emit again after clear
      const result = shouldEmitNotification({ taskId: 'task-c', eventUpdatedAt: 100, eventStatus: 'doing' })
      expect(result.emit).toBe(true)
    })

    it('pruneDedupeState removes old entries', () => {
      // Insert an entry with old timestamp
      shouldEmitNotification({ taskId: 'old-task', eventUpdatedAt: 1, eventStatus: 'doing' })
      shouldEmitNotification({ taskId: 'new-task', eventUpdatedAt: Date.now(), eventStatus: 'doing' })

      const pruned = pruneDedupeState(1000) // prune entries older than 1s
      expect(pruned).toBe(1) // old-task pruned

      const state = getDedupeState()
      expect(state.size).toBe(1)
      expect(state.cursors['new-task']).toBeDefined()
    })
  })

  describe('strict > cursor semantics', () => {
    it('uses strict > not >= for cursor comparison', () => {
      // First event at t=1000
      const r1 = shouldEmitNotification({ taskId: 'strict-test', eventUpdatedAt: 1000, eventStatus: 'doing' })
      expect(r1.emit).toBe(true)

      // Same timestamp — should NOT emit (uses <=, meaning = is rejected)
      const r2 = shouldEmitNotification({ taskId: 'strict-test', eventUpdatedAt: 1000, eventStatus: 'doing' })
      expect(r2.emit).toBe(false)

      // t+1 — should emit (strictly greater)
      const r3 = shouldEmitNotification({ taskId: 'strict-test', eventUpdatedAt: 1001, eventStatus: 'validating' })
      expect(r3.emit).toBe(true)
    })
  })
})
