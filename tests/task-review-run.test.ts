// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Tests for notifyReviewerViaRun and GET /agents/:agentId/runs/current/pending-reviews
 *
 * Task: task-review-run-wire
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  notifyReviewerViaRun,
  getActiveAgentRun,
  listPendingApprovals,
  createAgentRun,
  appendAgentEvent,
  submitApprovalDecision,
} from '../src/agent-runs.js'

// Each test uses a unique agentId to avoid cross-test DB state pollution.
let counter = 0
function uid(): string {
  return `reviewer-${Date.now()}-${++counter}`
}

describe('notifyReviewerViaRun', () => {
  it('creates a new run for the reviewer when none exists', () => {
    const reviewer = uid()
    const task = {
      id: 'task-test-001',
      title: 'Fix login bug',
      reviewer,
      assignee: 'dev-agent',
      metadata: {},
    }

    const run = notifyReviewerViaRun(task)

    expect(run).toBeTruthy()
    expect(run.agentId).toBe(reviewer)
    expect(run.status).toBe('waiting_review')
    expect(run.objective).toBe('pending reviews')
  })

  it('reuses the reviewer existing active run', () => {
    const reviewer = uid()
    const existing = createAgentRun(reviewer, 'default', 'ongoing work')

    notifyReviewerViaRun({
      id: 'task-test-002',
      title: 'Add search feature',
      reviewer,
      assignee: 'dev-agent',
    })

    // Should have reused the existing run
    const active = getActiveAgentRun(reviewer, 'default')
    expect(active?.id).toBe(existing.id)
    expect(active?.status).toBe('waiting_review')
  })

  it('appends a review_requested event with correct payload', () => {
    const reviewer = uid()
    const task = {
      id: 'task-test-003',
      title: 'Refactor auth module',
      reviewer,
      assignee: 'link',
      metadata: {
        pr_url: 'https://github.com/org/repo/pull/42',
        qa_bundle: {
          pr_url: 'https://github.com/org/repo/pull/42',
          summary: 'All tests pass, coverage 95%',
        },
      },
    }

    const run = notifyReviewerViaRun(task)

    const pending = listPendingApprovals({ agentId: reviewer })
    expect(pending.length).toBeGreaterThanOrEqual(1)

    const evt = pending[0]!.event
    expect(evt.eventType).toBe('review_requested')
    expect(evt.payload.task_id).toBe('task-test-003')
    expect(evt.payload.task_title).toBe('Refactor auth module')
    expect(evt.payload.pr_url).toBe('https://github.com/org/repo/pull/42')
    expect(evt.payload.assignee).toBe('link')
    expect(evt.payload.action_required).toBe('review')
    expect(evt.payload.urgency).toBe('normal')
    expect(evt.payload.qa_bundle_summary).toBe('All tests pass, coverage 95%')
    expect(evt.runId).toBe(run.id)
  })

  it('extracts pr_url from review_handoff when not at top level', () => {
    const reviewer = uid()
    notifyReviewerViaRun({
      id: 'task-test-004',
      title: 'Update docs',
      reviewer,
      assignee: 'writer',
      metadata: {
        review_handoff: { pr_url: 'https://github.com/org/repo/pull/99' },
      },
    })

    const pending = listPendingApprovals({ agentId: reviewer })
    expect(pending[0]!.event.payload.pr_url).toBe('https://github.com/org/repo/pull/99')
  })

  it('sets pr_url to null when no pr_url in metadata', () => {
    const reviewer = uid()
    notifyReviewerViaRun({
      id: 'task-test-005',
      title: 'Write tests',
      reviewer,
      assignee: 'qa-bot',
      metadata: {},
    })

    const pending = listPendingApprovals({ agentId: reviewer })
    expect(pending[0]!.event.payload.pr_url).toBeNull()
  })

  it('uses task teamId when provided', () => {
    const reviewer = uid()
    const run = notifyReviewerViaRun({
      id: 'task-test-006',
      title: 'Deploy to staging',
      reviewer,
      assignee: 'ops',
      teamId: 'team-alpha',
    })

    expect(run.teamId).toBe('team-alpha')
  })

  it('sets run status to waiting_review', () => {
    const reviewer = uid()
    notifyReviewerViaRun({
      id: 'task-test-007',
      title: 'Performance optimization',
      reviewer,
    })

    const active = getActiveAgentRun(reviewer, 'default')
    expect(active?.status).toBe('waiting_review')
  })
})

describe('listPendingApprovals — pending-reviews query', () => {
  it('returns review_requested events without a resolution', () => {
    const reviewer = uid()
    notifyReviewerViaRun({
      id: 'task-pending-001',
      title: 'Task needing review',
      reviewer,
      assignee: 'link',
    })

    const pending = listPendingApprovals({ agentId: reviewer })
    expect(pending.length).toBe(1)
    expect(pending[0]!.event.payload.task_id).toBe('task-pending-001')
  })

  it('excludes events that already have a review_approved resolution', async () => {
    const reviewer = uid()
    notifyReviewerViaRun({
      id: 'task-resolved-001',
      title: 'Already approved task',
      reviewer,
      assignee: 'link',
    })

    const pending = listPendingApprovals({ agentId: reviewer })
    expect(pending.length).toBe(1)

    // Wait 2ms to ensure resolution timestamp > request timestamp in SQLite integer ms
    await new Promise(r => setTimeout(r, 2))

    // Approve the review
    const eventId = pending[0]!.event.id
    submitApprovalDecision({
      eventId,
      decision: 'approve',
      reviewer,
      rationale: { choice: 'LGTM' },
    })

    // Should now be empty
    const afterApproval = listPendingApprovals({ agentId: reviewer })
    expect(afterApproval.length).toBe(0)
  })

  it('excludes events that have a review_rejected resolution', async () => {
    const reviewer = uid()
    notifyReviewerViaRun({
      id: 'task-rejected-001',
      title: 'Rejected task',
      reviewer,
      assignee: 'link',
    })

    const pending = listPendingApprovals({ agentId: reviewer })
    // Wait 2ms to ensure resolution timestamp > request timestamp in SQLite integer ms
    await new Promise(r => setTimeout(r, 2))

    const eventId = pending[0]!.event.id
    submitApprovalDecision({
      eventId,
      decision: 'reject',
      reviewer,
      rationale: { choice: 'Needs more work' },
    })

    const afterRejection = listPendingApprovals({ agentId: reviewer })
    expect(afterRejection.length).toBe(0)
  })

  it('accumulates multiple pending reviews', () => {
    const reviewer = uid()

    notifyReviewerViaRun({ id: 'task-multi-001', title: 'First review', reviewer })
    notifyReviewerViaRun({ id: 'task-multi-002', title: 'Second review', reviewer })
    notifyReviewerViaRun({ id: 'task-multi-003', title: 'Third review', reviewer })

    const pending = listPendingApprovals({ agentId: reviewer })
    expect(pending.length).toBe(3)
    const taskIds = pending.map(p => p.event.payload.task_id)
    expect(taskIds).toContain('task-multi-001')
    expect(taskIds).toContain('task-multi-002')
    expect(taskIds).toContain('task-multi-003')
  })

  it('does not cross-contaminate reviews for different reviewers', () => {
    const reviewer1 = uid()
    const reviewer2 = uid()

    notifyReviewerViaRun({ id: 'task-cross-001', title: 'For reviewer1', reviewer: reviewer1 })
    notifyReviewerViaRun({ id: 'task-cross-002', title: 'For reviewer2', reviewer: reviewer2 })

    expect(listPendingApprovals({ agentId: reviewer1 }).length).toBe(1)
    expect(listPendingApprovals({ agentId: reviewer2 }).length).toBe(1)
  })
})
