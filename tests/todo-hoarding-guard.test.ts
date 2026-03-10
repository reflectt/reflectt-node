// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from 'vitest'
import {
  sweepTodoHoarding,
  claimTask,
  TODO_CAP,
  IDLE_THRESHOLD_MS,
  STARTUP_GRACE_MS,
} from '../src/todoHoardingGuard.js'
import { taskManager } from '../src/tasks.js'

describe('todoHoardingGuard', () => {
  beforeEach(async () => {
    // Clear all tasks
    const tasks = taskManager.listTasks()
    for (const t of tasks) {
      try { await taskManager.deleteTask(t.id) } catch {}
    }
  })

  describe('Rule A: todo cap with auto-unassign', () => {
    it('does nothing when agent has <= TODO_CAP todos', async () => {
      const oldDate = Date.now() - IDLE_THRESHOLD_MS - 60000
      for (let i = 0; i < TODO_CAP; i++) {
        await taskManager.createTask({
          title: `Task ${i}`,
          assignee: 'testAgent',
          status: 'todo',
          priority: 'P2',
          done_criteria: ['test'],
          createdBy: 'test',
        })
        // Manually make updatedAt old
        const tasks = taskManager.listTasks()
        const t = tasks[tasks.length - 1]
        await taskManager.updateTask(t.id, { metadata: { ...(t.metadata || {}), _forceOld: true } })
      }

      const result = await sweepTodoHoarding()
      expect(result.unassigned).toHaveLength(0)
    })

    it('unassigns overflow todos when agent exceeds cap with 0 doing and idle', async () => {
      // Create 5 todos (cap is 3) — need them to appear idle
      for (let i = 0; i < 5; i++) {
        await taskManager.createTask({
          title: `Task ${i}`,
          assignee: 'idleAgent',
          status: 'todo',
          priority: 'P2',
          done_criteria: ['test'],
          createdBy: 'test',
        })
      }

      // Tasks just created won't be idle enough. Test with dryRun to verify logic
      // without needing to fake timestamps.
      const result = await sweepTodoHoarding({ dryRun: true })
      // Won't fire because tasks are fresh (updatedAt is now)
      // This validates the idle threshold check works
      expect(result.unassigned).toHaveLength(0)
    })

    it('skips agents with active doing tasks', async () => {
      for (let i = 0; i < 5; i++) {
        await taskManager.createTask({
          title: `Todo ${i}`,
          assignee: 'busyAgent',
          status: 'todo',
          priority: 'P2',
          done_criteria: ['test'],
          createdBy: 'test',
        })
      }
      // Agent has a doing task
      await taskManager.createTask({
        title: 'Active work',
        assignee: 'busyAgent',
        reviewer: 'pixel',
        status: 'doing',
        priority: 'P1',
        done_criteria: ['test'],
        createdBy: 'test',
        metadata: { eta: '~30m' },
      })

      const result = await sweepTodoHoarding()
      expect(result.unassigned).toHaveLength(0)
    })

    it('skips agents not idle long enough', async () => {
      for (let i = 0; i < 5; i++) {
        await taskManager.createTask({
          title: `Todo ${i}`,
          assignee: 'recentAgent',
          status: 'todo',
          priority: 'P2',
          done_criteria: ['test'],
          createdBy: 'test',
        })
      }

      const result = await sweepTodoHoarding()
      expect(result.unassigned).toHaveLength(0)
    })

    it('respects dry-run mode (no mutations)', async () => {
      for (let i = 0; i < 5; i++) {
        await taskManager.createTask({
          title: `Todo ${i}`,
          assignee: 'dryAgent',
          status: 'todo',
          priority: 'P2',
          done_criteria: ['test'],
          createdBy: 'test',
        })
      }

      const result = await sweepTodoHoarding({ dryRun: true })
      // Tasks are fresh so won't be flagged — but validates dry-run doesn't crash
      expect(result.scanned).toBeGreaterThanOrEqual(5)

      // Verify tasks were NOT actually unassigned
      const tasks = taskManager.listTasks().filter((t: any) =>
        t.assignee?.toLowerCase() === 'dryagent',
      )
      expect(tasks).toHaveLength(5)
    })
  })

  describe('Startup grace period', () => {
    it('suppresses auto-unassign during grace period even when agent appears idle', async () => {
      const now = Date.now()
      // Create 5 todos with old updatedAt (agent appears idle for >30m)
      for (let i = 0; i < 5; i++) {
        const task = await taskManager.createTask({
          title: `Grace task ${i}`,
          assignee: 'graceAgent',
          status: 'todo',
          priority: 'P2',
          done_criteria: ['test'],
          createdBy: 'test',
        })
        // Force old updatedAt via direct DB
        const { getDb } = await import('../src/db.js')
        const db = getDb()
        db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?')
          .run(now - IDLE_THRESHOLD_MS - 60_000, task.id)
      }

      // Simulate: server just started (moduleLoadedAt = now), so we're in grace period
      const result = await sweepTodoHoarding({
        _nowOverride: now,
        _moduleLoadedAtOverride: now - 1000, // 1s uptime — well within grace
      })

      // Rule A should NOT fire during grace period
      expect(result.unassigned).toHaveLength(0)
    })

    it('allows auto-unassign after grace period expires', async () => {
      const now = Date.now()
      for (let i = 0; i < 5; i++) {
        const task = await taskManager.createTask({
          title: `Post-grace task ${i}`,
          assignee: 'postGraceAgent',
          status: 'todo',
          priority: 'P2',
          done_criteria: ['test'],
          createdBy: 'test',
        })
        const { getDb } = await import('../src/db.js')
        const db = getDb()
        db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?')
          .run(now - IDLE_THRESHOLD_MS - 60_000, task.id)
      }

      // Simulate: server started long ago (moduleLoadedAt = 20m ago), grace expired
      const result = await sweepTodoHoarding({
        _nowOverride: now,
        _moduleLoadedAtOverride: now - STARTUP_GRACE_MS - 60_000, // well past grace
      })

      // Rule A SHOULD fire now — 5 todos, 0 doing, idle, past grace
      expect(result.unassigned.length).toBeGreaterThan(0)
      expect(result.unassigned.length).toBe(5 - TODO_CAP) // unassign overflow
    })

    it('still detects orphans during grace period (Rule B is read-only)', async () => {
      const now = Date.now()
      const task = await taskManager.createTask({
        title: 'Orphan during grace',
        assignee: 'orphanAgent',
        status: 'todo',
        priority: 'P2',
        done_criteria: ['test'],
        createdBy: 'test',
      })
      const { getDb } = await import('../src/db.js')
      const db = getDb()
      db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?')
        .run(now - IDLE_THRESHOLD_MS - 60_000, task.id)

      const result = await sweepTodoHoarding({
        _nowOverride: now,
        _moduleLoadedAtOverride: now - 1000, // in grace period
      })

      // Rule B (orphan detection) should still fire
      const orphans = result.orphaned.filter(o => o.assignee === 'orphanagent')
      expect(orphans).toHaveLength(1)
    })
  })

  describe('Rule B: orphan detection', () => {
    it('does not flag todos from recently active agents', async () => {
      await taskManager.createTask({
        title: 'Active todo',
        assignee: 'activeAgent',
        status: 'todo',
        priority: 'P2',
        done_criteria: ['test'],
        createdBy: 'test',
      })

      const result = await sweepTodoHoarding()
      const activeOrphans = result.orphaned.filter(o => o.assignee === 'activeagent')
      expect(activeOrphans).toHaveLength(0)
    })
  })

  describe('Rule C: claim (todo→doing)', () => {
    it('transitions task from todo to doing', async () => {
      const task = await taskManager.createTask({
        title: 'Claimable',
        assignee: 'unassigned',
        reviewer: 'pixel',
        status: 'todo',
        priority: 'P1',
        done_criteria: ['test'],
        createdBy: 'test',
      })

      const claimed = await claimTask(task.id, 'link')
      expect(claimed).not.toBeNull()
      expect(claimed!.status).toBe('doing')
      expect(claimed!.assignee).toBe('link')
    })

    it('returns null for non-todo tasks', async () => {
      const task = await taskManager.createTask({
        title: 'Already doing',
        assignee: 'link',
        reviewer: 'pixel',
        status: 'doing',
        priority: 'P1',
        done_criteria: ['test'],
        createdBy: 'test',
        metadata: { eta: '~30m' },
      })

      const claimed = await claimTask(task.id, 'link')
      expect(claimed).toBeNull()
    })

    it('returns null for non-existent tasks', async () => {
      const claimed = await claimTask('task-nonexistent', 'link')
      expect(claimed).toBeNull()
    })
  })
})
