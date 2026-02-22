// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as childProcess from 'node:child_process'
import {
  checkPrMergeability,
  attemptAutoMerge,
  autoPopulateCloseGate,
  tryAutoCloseTask,
  processAutoMerge,
  parsePrUrl,
  generateRemediation,
  getMergeAttemptLog,
  _clearMergeabilityCache,
} from '../src/prAutoMerge.js'
import { taskManager } from '../src/tasks.js'

// Mock execSync
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}))

const mockExecSync = vi.mocked(childProcess.execSync)

// ── Helpers ────────────────────────────────────────────────────────────────

const REVIEW_HANDOFF_BASE = {
  artifact_path: 'process/TASK-test.md',
  test_proof: 'vitest: 10 pass',
  known_caveats: 'none',
}

async function createValidatingTask(id: string, extraMeta: Record<string, unknown> = {}): Promise<string> {
  // Create as todo first (no gates), then move through lifecycle
  const task = await taskManager.createTask({
    title: `Test task ${id}`,
    status: 'todo',
    assignee: 'link',
    reviewer: 'sage',
    createdBy: 'test',
    done_criteria: ['Test criterion'],
  })

  // Move to doing (requires eta)
  await taskManager.updateTask(task.id, {
    status: 'doing',
    metadata: { eta: '~30m' },
  })

  // Move to validating (requires artifact_path + review_handoff)
  const prUrl = (extraMeta.pr_url as string) || `https://github.com/reflectt/reflectt-node/pull/${Math.floor(Math.random() * 1000)}`
  await taskManager.updateTask(task.id, {
    status: 'validating',
    metadata: {
      eta: '~30m',
      artifact_path: 'process/TASK-test.md',
      review_handoff: {
        ...REVIEW_HANDOFF_BASE,
        task_id: task.id,
        pr_url: prUrl,
        commit_sha: 'abc1234',
      },
      pr_url: prUrl,
      ...extraMeta,
    },
  })

  return task.id
}

async function createDoingTask(id: string, extraMeta: Record<string, unknown> = {}): Promise<string> {
  const task = await taskManager.createTask({
    title: `Test task ${id}`,
    status: 'todo',
    assignee: 'link',
    reviewer: 'sage',
    createdBy: 'test',
    done_criteria: ['Test criterion'],
  })

  await taskManager.updateTask(task.id, {
    status: 'doing',
    metadata: { eta: '~30m', ...extraMeta },
  })

  return task.id
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PR Auto-Merge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _clearMergeabilityCache()
  })

  describe('parsePrUrl', () => {
    it('parses valid GitHub PR URL', () => {
      const result = parsePrUrl('https://github.com/reflectt/reflectt-node/pull/42')
      expect(result).toEqual({ repo: 'reflectt/reflectt-node', prNumber: 42 })
    })

    it('returns null for invalid URL', () => {
      expect(parsePrUrl('https://example.com/not-a-pr')).toBeNull()
    })

    it('returns null for PR number 0', () => {
      expect(parsePrUrl('https://github.com/reflectt/reflectt-node/pull/0')).toBeNull()
    })
  })

  describe('checkPrMergeability', () => {
    it('returns mergeable=true for green+approved PR', () => {
      mockExecSync.mockReturnValueOnce(JSON.stringify({
        state: 'OPEN',
        reviewDecision: 'APPROVED',
        statusCheckRollup: [
          { name: 'ci', conclusion: 'SUCCESS' },
          { name: 'lint', conclusion: 'SUCCESS' },
        ],
      }) as any)

      const result = checkPrMergeability('https://github.com/reflectt/reflectt-node/pull/42')
      expect(result.mergeable).toBe(true)
      expect(result.reason).toBe('PR is green and approved')
      expect(result.state).toBe('OPEN')
      expect(result.reviewDecision).toBe('APPROVED')
      expect(result.checksStatus).toBe('passing')
    })

    it('returns mergeable=false for failing checks', () => {
      mockExecSync.mockReturnValueOnce(JSON.stringify({
        state: 'OPEN',
        reviewDecision: 'APPROVED',
        statusCheckRollup: [
          { name: 'ci', conclusion: 'SUCCESS' },
          { name: 'lint', conclusion: 'FAILURE' },
        ],
      }) as any)

      const result = checkPrMergeability('https://github.com/reflectt/reflectt-node/pull/42')
      expect(result.mergeable).toBe(false)
      expect(result.checksStatus).toBe('failing')
      expect(result.failingChecks).toContain('lint')
      expect(result.reason).toContain('Failing checks')
    })

    it('returns mergeable=false when not approved', () => {
      mockExecSync.mockReturnValueOnce(JSON.stringify({
        state: 'OPEN',
        reviewDecision: 'CHANGES_REQUESTED',
        statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }],
      }) as any)

      const result = checkPrMergeability('https://github.com/reflectt/reflectt-node/pull/42')
      expect(result.mergeable).toBe(false)
      expect(result.reason).toContain('CHANGES_REQUESTED')
    })

    it('returns mergeable=false when PR is already merged', () => {
      mockExecSync.mockReturnValueOnce(JSON.stringify({
        state: 'MERGED',
        reviewDecision: 'APPROVED',
        statusCheckRollup: [],
      }) as any)

      const result = checkPrMergeability('https://github.com/reflectt/reflectt-node/pull/42')
      expect(result.mergeable).toBe(false)
      expect(result.state).toBe('MERGED')
    })

    it('returns mergeable=false for pending checks', () => {
      mockExecSync.mockReturnValueOnce(JSON.stringify({
        state: 'OPEN',
        reviewDecision: 'APPROVED',
        statusCheckRollup: [{ name: 'ci', conclusion: 'PENDING' }],
      }) as any)

      const result = checkPrMergeability('https://github.com/reflectt/reflectt-node/pull/42')
      expect(result.mergeable).toBe(false)
      expect(result.checksStatus).toBe('pending')
    })

    it('handles gh CLI error gracefully', () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('gh: not authenticated')
      })

      const result = checkPrMergeability('https://github.com/reflectt/reflectt-node/pull/42')
      expect(result.mergeable).toBe(false)
      expect(result.state).toBe('UNKNOWN')
      expect(result.reason).toContain('gh CLI error')
    })

    it('handles invalid PR URL', () => {
      const result = checkPrMergeability('not-a-url')
      expect(result.mergeable).toBe(false)
      expect(result.reason).toBe('Invalid PR URL format')
    })
  })

  describe('attemptAutoMerge', () => {
    it('returns success when gh pr merge succeeds', () => {
      mockExecSync.mockReturnValueOnce('' as any) // merge
      mockExecSync.mockReturnValueOnce('abc1234def5678' as any) // get SHA

      const result = attemptAutoMerge('https://github.com/reflectt/reflectt-node/pull/42')
      expect(result.success).toBe(true)
      expect(result.error).toBeNull()
      expect(result.mergeCommitSha).toBe('abc1234def5678')
    })

    it('returns failure with error message when merge fails', () => {
      const error = new Error('merge conflict') as any
      error.stderr = Buffer.from('PR has merge conflicts')
      mockExecSync.mockImplementationOnce(() => { throw error })

      const result = attemptAutoMerge('https://github.com/reflectt/reflectt-node/pull/42')
      expect(result.success).toBe(false)
      expect(result.error).toContain('PR has merge conflicts')
    })

    it('returns failure for invalid PR URL', () => {
      const result = attemptAutoMerge('not-a-url')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid PR URL format')
    })
  })

  describe('autoPopulateCloseGate', () => {
    it('populates missing metadata fields', async () => {
      const taskId = await createValidatingTask('populate-1')

      // Mock for commit SHA fetch
      mockExecSync.mockReturnValueOnce('deadbeef1234567' as any)

      const result = autoPopulateCloseGate(taskId, 'https://github.com/reflectt/reflectt-node/pull/42')

      expect(result.populated).toBe(true)
      expect(result.fields).toContain('pr_merged')

      const updated = taskManager.getTask(taskId)
      expect(updated?.metadata).toBeDefined()
      const meta = updated!.metadata as Record<string, unknown>
      expect(meta.pr_merged).toBe(true)
    })

    it('returns error for non-existent task', () => {
      const result = autoPopulateCloseGate('task-does-not-exist')
      expect(result.populated).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  describe('tryAutoCloseTask', () => {
    it('closes task when all gates pass', async () => {
      const taskId = await createValidatingTask('close-ok', {
        pr_merged: true,
        reviewer_approved: true,
      })

      const result = tryAutoCloseTask(taskId)
      expect(result.closed).toBe(true)
      expect(result.failedGates).toHaveLength(0)

      const updated = taskManager.getTask(taskId)
      expect(updated?.status).toBe('done')
    })

    it('does not close when reviewer_approved is missing', async () => {
      const taskId = await createValidatingTask('close-no-review', {
        pr_merged: true,
      })

      const result = tryAutoCloseTask(taskId)
      expect(result.closed).toBe(false)
      expect(result.failedGates).toContain('reviewer_approved')

      const updated = taskManager.getTask(taskId)
      expect(updated?.status).toBe('validating')
    })

    it('does not close when pr_merged is missing', async () => {
      const taskId = await createValidatingTask('close-no-merge', {
        reviewer_approved: true,
      })

      const result = tryAutoCloseTask(taskId)
      expect(result.closed).toBe(false)
      expect(result.failedGates).toContain('pr_merged')
    })

    it('does not close non-validating tasks', async () => {
      const taskId = await createDoingTask('close-doing', {
        pr_merged: true,
        reviewer_approved: true,
        artifact_path: 'process/TASK-test.md',
      })

      const result = tryAutoCloseTask(taskId)
      expect(result.closed).toBe(false)
      expect(result.reason).toContain('not validating')
    })
  })

  describe('processAutoMerge (sweep integration)', () => {
    it('attempts merge for green+approved PR', async () => {
      const prUrl = 'https://github.com/reflectt/reflectt-node/pull/99'
      const taskId = await createValidatingTask('sweep-merge', {
        pr_url: prUrl,
        reviewer_approved: true,
      })

      // checkPrMergeability
      mockExecSync.mockReturnValueOnce(JSON.stringify({
        state: 'OPEN',
        reviewDecision: 'APPROVED',
        statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }],
      }) as any)
      // attemptAutoMerge
      mockExecSync.mockReturnValueOnce('' as any)
      // get merge commit SHA after merge
      mockExecSync.mockReturnValueOnce('abc1234def5678' as any)
      // autoPopulateCloseGate commit SHA
      mockExecSync.mockReturnValueOnce('abc1234def5678' as any)

      const allTasks = taskManager.listTasks()
      const result = processAutoMerge(allTasks)

      expect(result.mergeAttempts).toBeGreaterThanOrEqual(1)
      expect(result.mergeSuccesses).toBeGreaterThanOrEqual(1)
    })

    it('skips merge for failing checks and logs reason', async () => {
      const prUrl = 'https://github.com/reflectt/reflectt-node/pull/100'
      const taskId = await createValidatingTask('sweep-fail', {
        pr_url: prUrl,
      })

      // checkPrMergeability: failing
      mockExecSync.mockReturnValueOnce(JSON.stringify({
        state: 'OPEN',
        reviewDecision: 'APPROVED',
        statusCheckRollup: [{ name: 'ci', conclusion: 'FAILURE' }],
      }) as any)

      const allTasks = taskManager.listTasks()
      processAutoMerge(allTasks)

      const log = getMergeAttemptLog()
      const skipped = log.filter(l => l.taskId === taskId && l.action === 'merge_skipped')
      expect(skipped.length).toBeGreaterThanOrEqual(1)
      expect(skipped[0].detail).toContain('Failing checks')
    })

    it('auto-closes already-merged PR when gates pass', async () => {
      const taskId = await createValidatingTask('sweep-autoclose', {
        pr_merged: true,
        reviewer_approved: true,
        pr_url: 'https://github.com/reflectt/reflectt-node/pull/101',
      })

      const allTasks = taskManager.listTasks()
      const result = processAutoMerge(allTasks)

      expect(result.autoCloses).toBeGreaterThanOrEqual(1)

      const updated = taskManager.getTask(taskId)
      expect(updated?.status).toBe('done')
    })
  })

  describe('generateRemediation', () => {
    it('generates remediation for stale_validating', () => {
      const rem = generateRemediation({
        taskId: 'task-123',
        issue: 'stale_validating',
        prUrl: 'https://github.com/reflectt/reflectt-node/pull/42',
      })
      expect(rem).toContain('PATCH /tasks/task-123')
      expect(rem).toContain('reviewer_approved')
    })

    it('generates remediation for pr_merged_not_closed', () => {
      const rem = generateRemediation({
        taskId: 'task-456',
        issue: 'pr_merged_not_closed',
      })
      expect(rem).toContain('PATCH /tasks/task-456')
      expect(rem).toContain('done')
    })

    it('generates remediation for orphan_pr with gh command', () => {
      const rem = generateRemediation({
        taskId: 'task-789',
        issue: 'orphan_pr',
        prUrl: 'https://github.com/reflectt/reflectt-node/pull/42',
      })
      expect(rem).toContain('gh pr merge 42')
      expect(rem).toContain('reflectt/reflectt-node')
    })

    it('generates remediation for no_pr_linked', () => {
      const rem = generateRemediation({
        taskId: 'task-000',
        issue: 'no_pr_linked',
      })
      expect(rem).toContain('PATCH /tasks/task-000')
      expect(rem).toContain('pr_url')
    })
  })
})
