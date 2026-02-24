import { describe, expect, it } from 'vitest'
import { isAutoClosable } from '../src/executionSweeper.js'

describe('auto-close reconciled validating tasks', () => {
  const baseTask = {
    id: 'task-test-1',
    title: 'Test reconciled task',
    status: 'validating' as const,
    assignee: 'sage',
    reviewer: 'link',
    createdBy: 'insight-bridge',
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 30_000,
    priority: 'P1' as const,
  }

  it('auto-closes reconciled + approved task with no PR', () => {
    const meta = {
      reconciled: true,
      reviewer_approved: true,
      source_insight: 'ins-123',
      source_reflection: 'ref-456',
    }
    expect(isAutoClosable(baseTask as any, meta)).toBe(true)
  })

  it('auto-closes reconciled + review_state approved with no PR', () => {
    const meta = {
      reconciled: true,
      review_state: 'approved',
      source_insight: 'ins-123',
    }
    expect(isAutoClosable(baseTask as any, meta)).toBe(true)
  })

  it('auto-closes reconciled + approved task with merged PR', () => {
    const meta = {
      reconciled: true,
      reviewer_approved: true,
      pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
      pr_merged: true,
      merge_commit: 'abc1234',
    }
    expect(isAutoClosable(baseTask as any, meta)).toBe(true)
  })

  it('does NOT auto-close reconciled task with unmerged PR', () => {
    const meta = {
      reconciled: true,
      reviewer_approved: true,
      pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
      // pr_merged not set — PR still open
    }
    expect(isAutoClosable(baseTask as any, meta)).toBe(false)
  })

  it('does NOT auto-close non-reconciled task', () => {
    const meta = {
      reviewer_approved: true,
    }
    expect(isAutoClosable(baseTask as any, meta)).toBe(false)
  })

  it('does NOT auto-close reconciled task without approval', () => {
    const meta = {
      reconciled: true,
      // no reviewer_approved or review_state
    }
    expect(isAutoClosable(baseTask as any, meta)).toBe(false)
  })

  // Regression: reconciled task enters validating → should be auto-closable
  // when approved with no code delta, preventing SLA escalation noise.
  it('regression: reconciled task with evidence packet + approval is auto-closable', () => {
    const meta = {
      reconciled: true,
      reconciled_at: Date.now() - 120_000,
      reviewer_approved: true,
      review_state: 'approved',
      source_insight: 'ins-regression-test',
      source_reflection: 'ref-regression-test',
      qa_bundle: {
        lane: 'backend',
        summary: 'Reconciled insight fix',
      },
    }
    expect(isAutoClosable(baseTask as any, meta)).toBe(true)
  })
})
