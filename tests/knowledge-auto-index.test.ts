import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  onTaskShipped,
  onProcessFileWritten,
  onDecisionComment,
  isDecisionComment,
} from '../src/knowledge-auto-index.js'

// Mock embeddings + vector store to avoid needing real models/sqlite-vec
vi.mock('../src/embeddings.js', () => ({
  embed: vi.fn(async () => new Float32Array(384)),
}))

const upsertSpy = vi.fn()
vi.mock('../src/vector-store.js', () => ({
  upsertVector: (...args: any[]) => upsertSpy(...args),
}))

describe('Knowledge Auto-Index Pipeline', () => {
  beforeEach(() => {
    upsertSpy.mockReset()
  })

  describe('isDecisionComment', () => {
    it('detects category=decision', () => {
      expect(isDecisionComment('any content', 'decision')).toBe(true)
    })

    it('detects "Decision:" prefix', () => {
      expect(isDecisionComment('Decision: we will use Fastify')).toBe(true)
    })

    it('detects [decision] tag', () => {
      expect(isDecisionComment('We agreed [decision] to ship this week')).toBe(true)
    })

    it('rejects normal comments', () => {
      expect(isDecisionComment('Updated the tests', null)).toBe(false)
      expect(isDecisionComment('LGTM, merging')).toBe(false)
    })
  })

  describe('onTaskShipped', () => {
    it('indexes task, QA bundle, and artifacts', async () => {
      const indexed = await onTaskShipped({
        taskId: 'task-ship-test',
        title: 'Fix the auth flow',
        description: 'Broken login for SSO users',
        doneCriteria: ['Login works for SSO', 'No 500 errors'],
        assignee: 'link',
        metadata: {
          qa_bundle: { summary: 'SSO auth fix verified with integration tests' },
          artifacts: ['https://github.com/reflectt/reflectt-node/pull/100'],
          artifact_path: 'process/TASK-auth-fix.md',
        },
      })

      // Should index: task_ship + qa_bundle + 2 artifacts (PR + artifact_path)
      expect(indexed).toBeGreaterThanOrEqual(3)
      expect(upsertSpy).toHaveBeenCalled()

      // Check source types
      const sourceTypes = upsertSpy.mock.calls.map((c: any[]) => c[1])
      expect(sourceTypes).toContain('task_ship')
      expect(sourceTypes).toContain('qa_bundle')
      expect(sourceTypes).toContain('artifact')
    })

    it('handles task with no metadata gracefully', async () => {
      const indexed = await onTaskShipped({
        taskId: 'task-minimal',
        title: 'Simple task',
      })

      expect(indexed).toBe(1) // just the task itself
    })

    it('does not re-index same task on repeated calls', async () => {
      // Use a unique taskId
      const taskId = `task-dedup-${Date.now()}`
      await onTaskShipped({ taskId, title: 'Dedup test' })
      const count1 = upsertSpy.mock.calls.length

      await onTaskShipped({ taskId, title: 'Dedup test' })
      const count2 = upsertSpy.mock.calls.length

      expect(count2).toBe(count1) // No additional calls
    })
  })

  describe('onProcessFileWritten', () => {
    it('indexes a process file', async () => {
      const result = await onProcessFileWritten(
        'process/TASK-test.md',
        '# Task Test\n\nThis is a process artifact.',
      )
      expect(result).toBe(true)
      expect(upsertSpy).toHaveBeenCalled()

      const call = upsertSpy.mock.calls.find((c: any[]) => c[1] === 'shared_file')
      expect(call).toBeDefined()
      expect(call[2]).toBe('process/TASK-test.md')
    })

    it('re-indexes on content change (no dedup for file writes)', async () => {
      await onProcessFileWritten('process/re-index.md', 'Version 1')
      const count1 = upsertSpy.mock.calls.length

      await onProcessFileWritten('process/re-index.md', 'Version 2')
      const count2 = upsertSpy.mock.calls.length

      expect(count2).toBe(count1 + 1) // Re-indexed with new content
    })
  })

  describe('onDecisionComment', () => {
    it('indexes a decision comment', async () => {
      const result = await onDecisionComment({
        taskId: 'task-123',
        commentId: 'comment-dec-1',
        author: 'sage',
        content: 'Decision: We will use JWT for auth tokens',
        taskTitle: 'Auth design',
      })
      expect(result).toBe(true)
      expect(upsertSpy).toHaveBeenCalled()

      const call = upsertSpy.mock.calls.find((c: any[]) => c[1] === 'decision')
      expect(call).toBeDefined()
      expect(call[3]).toContain('JWT')
      expect(call[3]).toContain('Auth design')
    })

    it('does not re-index same comment', async () => {
      const commentId = `comment-dedup-${Date.now()}`
      await onDecisionComment({
        taskId: 'task-x',
        commentId,
        author: 'link',
        content: 'Decision: ship it',
      })
      const count1 = upsertSpy.mock.calls.length

      await onDecisionComment({
        taskId: 'task-x',
        commentId,
        author: 'link',
        content: 'Decision: ship it',
      })
      const count2 = upsertSpy.mock.calls.length

      expect(count2).toBe(count1) // No duplicate
    })
  })
})
