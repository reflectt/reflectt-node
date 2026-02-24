import { describe, it, expect } from 'vitest'
import { getEffectiveActivity, formatActivityWarning, type ActivitySignal } from '../src/activity-signal.js'
import { getDb } from '../src/db.js'

describe('Activity Signal', () => {

  describe('getEffectiveActivity', () => {

    it('returns task_created fallback when no comments or history', () => {
      const signal = getEffectiveActivity('task-nonexistent-999', null, 1000000)
      expect(signal.effectiveActivityTs).toBe(1000000)
      expect(signal.source).toBe('task_created')
      expect(signal.signals.lastCommentAt).toBeNull()
      expect(signal.signals.lastStateTransitionAt).toBeNull()
      expect(signal.signals.taskCreatedAt).toBe(1000000)
    })

    it('returns status_comment when comment is most recent', () => {
      const db = getDb()
      const taskId = `task-signal-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const commentTs = Date.now() - 5000

      db.prepare(`
        INSERT INTO tasks (id, title, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(taskId, 'Test task', 'doing', 'link', commentTs - 60000, commentTs - 60000)

      db.prepare(`
        INSERT INTO task_comments (id, task_id, author, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).run(`tc-${Date.now()}-a`, taskId, 'link', 'Status update', commentTs)

      const signal = getEffectiveActivity(taskId, 'link', commentTs - 60000)
      expect(signal.effectiveActivityTs).toBe(commentTs)
      expect(signal.source).toBe('status_comment')
      expect(signal.signals.lastCommentAt).toBe(commentTs)
    })

    it('returns state_transition when history is most recent', () => {
      const db = getDb()
      const taskId = `task-signal-hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const historyTs = Date.now() - 3000
      const commentTs = Date.now() - 10000

      db.prepare(`
        INSERT INTO tasks (id, title, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(taskId, 'Test task 2', 'doing', 'link', commentTs - 60000, historyTs)

      db.prepare(`
        INSERT INTO task_comments (id, task_id, author, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).run(`tc-hist-${Date.now()}-b`, taskId, 'link', 'Old comment', commentTs)

      db.prepare(`
        INSERT INTO task_history (id, task_id, type, actor, timestamp, data)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(`th-${Date.now()}-c`, taskId, 'status_change', 'link', historyTs,
        JSON.stringify({ from: 'todo', to: 'doing' }))

      const signal = getEffectiveActivity(taskId, 'link', commentTs - 60000)
      expect(signal.effectiveActivityTs).toBe(historyTs)
      expect(signal.source).toBe('state_transition')
    })

    it('monotonic guard: newer signal always wins', () => {
      const db = getDb()
      const taskId = `task-signal-mono-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const now = Date.now()
      const newerTs = now - 1000
      const olderTs = now - 60000

      db.prepare(`
        INSERT INTO tasks (id, title, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(taskId, 'Monotonic test', 'doing', 'link', olderTs - 60000, olderTs)

      db.prepare(`
        INSERT INTO task_history (id, task_id, type, actor, timestamp, data)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(`th-mono-${Date.now()}-d`, taskId, 'status_change', 'link', olderTs, '{}')

      db.prepare(`
        INSERT INTO task_comments (id, task_id, author, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).run(`tc-mono-${Date.now()}-e`, taskId, 'link', 'Fresh status', newerTs)

      const signal = getEffectiveActivity(taskId, 'link', olderTs - 60000)

      expect(signal.effectiveActivityTs).toBe(newerTs)
      expect(signal.source).toBe('status_comment')

      // Monotonic: effectiveActivityTs >= all individual signals
      expect(signal.effectiveActivityTs).toBeGreaterThanOrEqual(signal.signals.taskCreatedAt)
      if (signal.signals.lastStateTransitionAt) {
        expect(signal.effectiveActivityTs).toBeGreaterThanOrEqual(signal.signals.lastStateTransitionAt)
      }
    })

    it('comment recency prevents stale alert', () => {
      const db = getDb()
      const taskId = `task-signal-fresh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const now = Date.now()
      const recentCommentTs = now - 5 * 60_000  // 5 min ago
      const oldCreatedAt = now - 200 * 60_000   // 200 min ago

      db.prepare(`
        INSERT INTO tasks (id, title, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(taskId, 'Fresh comment test', 'doing', 'link', oldCreatedAt, oldCreatedAt)

      db.prepare(`
        INSERT INTO task_comments (id, task_id, author, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).run(`tc-fresh-${Date.now()}-f`, taskId, 'link', 'Still working on this', recentCommentTs)

      const signal = getEffectiveActivity(taskId, 'link', oldCreatedAt)
      const staleThresholdMs = 90 * 60_000

      expect(signal.effectiveActivityTs).toBe(recentCommentTs)
      expect(now - signal.effectiveActivityTs).toBeLessThan(staleThresholdMs)
    })

    it('agent-scoped: only counts comments by assigned agent', () => {
      const db = getDb()
      const taskId = `task-signal-scope-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const now = Date.now()

      db.prepare(`
        INSERT INTO tasks (id, title, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(taskId, 'Scope test', 'doing', 'link', now - 120 * 60_000, now - 120 * 60_000)

      db.prepare(`
        INSERT INTO task_comments (id, task_id, author, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).run(`tc-other-${Date.now()}-g`, taskId, 'sage', 'Review comment', now - 2 * 60_000)

      // Agent-scoped: no comment by 'link'
      const signal = getEffectiveActivity(taskId, 'link', now - 120 * 60_000)
      expect(signal.signals.lastCommentAt).toBeNull()

      // Unscoped: finds sage's comment
      const signalAll = getEffectiveActivity(taskId, null, now - 120 * 60_000)
      expect(signalAll.signals.lastCommentAt).toBe(now - 2 * 60_000)
    })
  })

  describe('formatActivityWarning', () => {

    it('formats signal with age, source, and threshold', () => {
      const now = Date.now()
      const signal: ActivitySignal = {
        effectiveActivityTs: now - 95 * 60_000,
        source: 'status_comment',
        signals: {
          lastCommentAt: now - 95 * 60_000,
          lastStateTransitionAt: now - 200 * 60_000,
          taskCreatedAt: now - 300 * 60_000,
        },
      }

      const msg = formatActivityWarning(signal, 90, now)
      expect(msg).toContain('95m ago')
      expect(msg).toContain('status comment')
      expect(msg).toContain('threshold: 90m')
      expect(msg).toContain('UTC')
    })

    it('formats task_created source', () => {
      const now = Date.now()
      const signal: ActivitySignal = {
        effectiveActivityTs: now - 120 * 60_000,
        source: 'task_created',
        signals: {
          lastCommentAt: null,
          lastStateTransitionAt: null,
          taskCreatedAt: now - 120 * 60_000,
        },
      }

      const msg = formatActivityWarning(signal, 90, now)
      expect(msg).toContain('120m ago')
      expect(msg).toContain('task created')
    })
  })
})
