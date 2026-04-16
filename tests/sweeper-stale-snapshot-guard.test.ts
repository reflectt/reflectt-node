// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// Proof tests for the stale-snapshot duplicate-notification guard.
//
// Before this fix: sweepValidatingQueue() operated on a snapshot taken at sweep
// start. If a task was closed concurrently (chat approval, review endpoint), the
// sweeper still processed it and fired a second notification to #task-notifications.
//
// After this fix: all four auto-close paths re-check live task status via
// resolveTaskId() before calling updateTask + chatManager.sendMessage.
// Already-closed tasks are skipped entirely — no duplicate write, no duplicate ping.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

const sendMessage = vi.hoisted(() => vi.fn(async () => ({ id: 'mock-msg', timestamp: Date.now() })))

vi.mock('../src/chat.js', () => ({
  chatManager: { sendMessage },
}))

// Allow all alerts through — we're testing notification counts, not preflight.
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

// Prevent real `gh pr` CLI calls during sweeper's PR-state checks.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execSync: () => 'UNKNOWN',
  }
})

// No real auto-merge attempts.
vi.mock('../src/prAutoMerge.js', () => ({
  processAutoMerge: () => ({ mergeAttempts: 0, mergeSuccesses: 0, autoCloses: 0, skipped: 0 }),
  generateRemediation: () => '',
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sweeper stale-snapshot duplicate-notification guard', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  beforeEach(() => {
    sendMessage.mockClear()
  })

  /**
   * Create a task that isAutoClosable() will approve:
   * status=validating, reconciled=true, reviewer_approved=true
   */
  async function createAutoClosableTask(label: string) {
    const testAgent = `sweeper-guard-test-${Date.now()}`

    const createRes = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        title: `[guard-proof] ${label}`,
        description: 'Sweeper stale-snapshot guard proof task',
        status: 'todo',
        assignee: testAgent,
        reviewer: 'sage',
        priority: 'P2',
        createdBy: 'test',
        eta: '1h',
        done_criteria: ['Proof passes'],
      },
    })
    expect(createRes.statusCode).toBe(200)
    const task = JSON.parse(createRes.body).task

    // todo → doing
    const doingRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: { status: 'doing', metadata: { eta: '1h', wip_override: 'test isolation' } },
    })
    expect(doingRes.statusCode).toBe(200)

    // doing → validating (with required artifact_path)
    const valRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'validating',
        metadata: {
          artifact_path: 'process/sweeper-guard-proof.md',
          review_handoff: {
            task_id: task.id,
            artifact_path: 'process/sweeper-guard-proof.md',
            test_proof: 'pass',
            known_caveats: 'test only',
            doc_only: true,
          },
          qa_bundle: {
            lane: 'test',
            summary: 'Guard proof task',
            changed_files: ['process/sweeper-guard-proof.md'],
            artifact_links: ['process/sweeper-guard-proof.md'],
            checks: ['lint:pass'],
            screenshot_proof: ['n/a'],
            review_packet: {
              task_id: task.id,
              artifact_path: 'process/sweeper-guard-proof.md',
              // pr_url + commit allow GitHub blob fallback to satisfy the artifact retrievability gate.
              pr_url: 'https://github.com/reflectt/reflectt-node/pull/1240',
              commit: 'abc1234',
            },
          },
        },
      },
    })
    expect(valRes.statusCode).toBe(200)

    // Mark as reconciled + approved — this is what makes isAutoClosable() return true.
    const { taskManager } = await import('../src/tasks.js')
    taskManager.patchTaskMetadata(task.id, {
      reconciled: true,
      reviewer_approved: true,
    })

    return JSON.parse(valRes.body).task
  }

  // ── Proof 1: race case ─────────────────────────────────────────────────────
  it('race case: task already done before sweep → guard fires, no duplicate notification', async () => {
    const task = await createAutoClosableTask('race-case')

    // Simulate concurrent close: mark done before the sweep runs.
    // This is what chat approval or review endpoint would do.
    const { taskManager } = await import('../src/tasks.js')
    await taskManager.updateTask(task.id, {
      status: 'done',
      metadata: {
        reconciled: true,
        reviewer_approved: true,
        artifact_path: 'process/sweeper-guard-proof.md',
        concurrent_close: true,
      },
    } as any)

    // Clear any notifications fired by the updateTask above.
    sendMessage.mockClear()

    // Verify live status is done before sweep.
    const liveCheck = taskManager.resolveTaskId(task.id)
    expect(liveCheck.task?.status).toBe('done')

    // Run the sweep — should detect task is already done and skip it entirely.
    const { sweepValidatingQueue } = await import('../src/executionSweeper.js')
    await sweepValidatingQueue()

    // No notification for this task from the sweeper.
    const callsForTask = sendMessage.mock.calls.filter(
      c => typeof c[0]?.content === 'string' && c[0].content.includes(task.id),
    )
    expect(callsForTask).toHaveLength(0)
  })

  // ── Proof 2: real auto-close ───────────────────────────────────────────────
  it('real auto-close: task still validating → guard passes, exactly one notification fires', async () => {
    const task = await createAutoClosableTask('real-auto-close')

    // Clear notifications from task creation.
    sendMessage.mockClear()

    // Verify task is still validating before sweep.
    const { taskManager } = await import('../src/tasks.js')
    const liveCheck = taskManager.resolveTaskId(task.id)
    expect(liveCheck.task?.status).toBe('validating')

    // Run the sweep — task is genuinely in validating, guard passes, sweeper closes it.
    const { sweepValidatingQueue } = await import('../src/executionSweeper.js')
    await sweepValidatingQueue()

    // Exactly one notification to #task-notifications for this task.
    const callsForTask = sendMessage.mock.calls.filter(
      c => typeof c[0]?.content === 'string' && c[0].content.includes(task.id),
    )
    expect(callsForTask).toHaveLength(1)
    expect(callsForTask[0][0].channel).toBe('task-notifications')

    // And the task is now done in the DB.
    const afterSweep = taskManager.resolveTaskId(task.id)
    expect(afterSweep.task?.status).toBe('done')
  })
})
