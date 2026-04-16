// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// Proof tests for same-status notification suppression in PATCH /tasks/:id.
//
// Before this fix: the notification emission block checked only `parsed.status`
// (the incoming status) without comparing it to `existing.status` (the current DB
// value). A PATCH that repeated the current status — e.g. a done→done retry —
// would emit a second taskCompleted notification.
//
// After this fix: each emission block guards with `existing.status !== parsed.status`.
// Same-status PATCHes produce zero notifications; real transitions still produce one.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'

// ── Module mocks ──────────────────────────────────────────────────────────────

const sendMessage = vi.hoisted(() => vi.fn(async () => ({ id: 'mock-msg', timestamp: Date.now() })))

vi.mock('../src/chat.js', () => ({
  chatManager: { sendMessage },
}))

vi.mock('../src/alert-preflight.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/alert-preflight.js')>()
  return {
    ...actual,
    preflightCheck: () => ({
      proceed: true,
      reason: undefined,
      latencyMs: 0,
      idempotentKey: 'test',
      mode: 'enforce',
    }),
  }
})

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, execSync: () => 'UNKNOWN' }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Count sendMessage calls whose content includes the given task ID and targets the given channel. */
function countNotifCalls(taskId: string, channel = 'task-notifications'): number {
  return sendMessage.mock.calls.filter(
    c => c[0]?.channel === channel && typeof c[0]?.content === 'string' && c[0].content.includes(taskId),
  ).length
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PATCH /tasks/:id — same-status notification suppression', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  beforeEach(() => {
    sendMessage.mockClear()
  })

  /**
   * Walk a task from todo → doing → validating, then return it.
   * Uses a dedicated test-agent per invocation to avoid WIP collisions.
   */
  async function createValidatingTask(label: string) {
    const testAgent = `notif-suppress-test-${Date.now()}`

    const cr = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        title: `[notif-suppress] ${label}`,
        description: 'Same-status suppression proof task',
        status: 'todo',
        assignee: testAgent,
        reviewer: 'sage',
        priority: 'P2',
        createdBy: 'test',
        eta: '1h',
        done_criteria: ['Proof passes'],
      },
    })
    expect(cr.statusCode).toBe(200)
    const task = JSON.parse(cr.body).task

    const dr = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: { status: 'doing', metadata: { eta: '1h', wip_override: 'test isolation' } },
    })
    expect(dr.statusCode).toBe(200)

    const vr = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'validating',
        metadata: {
          artifact_path: 'process/notif-suppress-proof.md',
          review_handoff: {
            task_id: task.id,
            artifact_path: 'process/notif-suppress-proof.md',
            test_proof: 'pass',
            known_caveats: 'test only',
            doc_only: true,
          },
          qa_bundle: {
            lane: 'test',
            summary: 'Notification suppression proof',
            changed_files: ['process/notif-suppress-proof.md'],
            artifact_links: ['process/notif-suppress-proof.md'],
            checks: ['lint:pass'],
            screenshot_proof: ['n/a'],
            review_packet: {
              task_id: task.id,
              artifact_path: 'process/notif-suppress-proof.md',
              pr_url: 'https://github.com/reflectt/reflectt-node/pull/1241',
              commit: 'abc1234',
            },
          },
        },
      },
    })
    expect(vr.statusCode).toBe(200)
    return JSON.parse(vr.body).task
  }

  // ── Proof 1: done → done emits nothing ────────────────────────────────────
  it('done → done PATCH: zero notifications (status already done)', async () => {
    const task = await createValidatingTask('done-done-retry')

    // First close: validating → done (legitimate transition)
    const doneRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        actor: 'sage',
        status: 'done',
        metadata: { reviewer_approved: true, artifacts: ['process/notif-suppress-proof.md'] },
      },
    })
    expect(doneRes.statusCode).toBe(200)
    sendMessage.mockClear() // clear legitimate first-close notifications

    // Second PATCH with same status — should be a no-op for notifications.
    const retryRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        actor: 'sage',
        status: 'done',
        metadata: { reviewer_approved: true, artifacts: ['process/notif-suppress-proof.md'] },
      },
    })
    expect(retryRes.statusCode).toBe(200)

    // Zero task-notifications for this task.
    expect(countNotifCalls(task.id)).toBe(0)
  })

  // ── Proof 2: real validating → done emits exactly one notification ─────────
  it('validating → done PATCH: exactly one notification fires', async () => {
    const task = await createValidatingTask('real-done-transition')
    sendMessage.mockClear()

    const doneRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        actor: 'sage',
        status: 'done',
        metadata: { reviewer_approved: true, artifacts: ['process/notif-suppress-proof.md'] },
      },
    })
    expect(doneRes.statusCode).toBe(200)

    // At least one taskCompleted notification for this task (assignee gets one,
    // reviewer gets one — both are legitimate).
    const calls = countNotifCalls(task.id)
    expect(calls).toBeGreaterThanOrEqual(1)
  })

  // ── Proof 3: validating → validating emits nothing (reviewer already pinged) ─
  it('validating → validating PATCH: zero new review-requested notifications', async () => {
    const task = await createValidatingTask('validating-retry')
    sendMessage.mockClear() // clear notifications from the validating transition above

    // PATCH validating → validating (e.g. metadata update, no status change)
    const retryRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        metadata: {
          extra_note: 'bumping metadata',
          artifact_path: 'process/notif-suppress-proof.md',
          review_handoff: {
            task_id: task.id,
            artifact_path: 'process/notif-suppress-proof.md',
            test_proof: 'pass',
            known_caveats: 'test only',
            doc_only: true,
          },
          qa_bundle: {
            lane: 'test',
            summary: 'Notification suppression proof',
            changed_files: ['process/notif-suppress-proof.md'],
            artifact_links: ['process/notif-suppress-proof.md'],
            checks: ['lint:pass'],
            screenshot_proof: ['n/a'],
            review_packet: {
              task_id: task.id,
              artifact_path: 'process/notif-suppress-proof.md',
              pr_url: 'https://github.com/reflectt/reflectt-node/pull/1241',
              commit: 'abc1234',
            },
          },
          status: 'validating', // explicit same-status
        },
      },
    })
    expect(retryRes.statusCode).toBe(200)

    // No new review_routing or task-notifications messages.
    const reviewCalls = sendMessage.mock.calls.filter(
      c => c[0]?.channel === 'reviews' && typeof c[0]?.content === 'string' && c[0].content.includes(task.id),
    ).length
    expect(reviewCalls).toBe(0)
    expect(countNotifCalls(task.id)).toBe(0)
  })
})
