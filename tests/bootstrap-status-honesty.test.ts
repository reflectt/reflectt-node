// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// Proof tests for bootstrap status honesty fix in GET /host/status and GET /doctor.
//
// Before this fix: both endpoints reported BOOTSTRAP_IN_PROGRESS / "Bootstrap is running"
// even when the bootstrap task was in `todo` status (never claimed by any agent). An
// operator told to "wait" had nothing to wait for.
//
// After this fix:
// - bootstrap task `todo` → BOOTSTRAP_NOT_STARTED + "no agent has claimed it"
// - bootstrap task `doing` → BOOTSTRAP_IN_PROGRESS + "Bootstrap is running" (unchanged)
// - /doctor and /host/status stay aligned on the same truth

import { describe, it, expect, beforeAll, vi } from 'vitest'
import Fastify from 'fastify'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../src/chat.js', () => ({
  chatManager: {
    sendMessage: vi.fn(async () => ({ id: 'mock-msg', timestamp: Date.now() })),
    getMessages: vi.fn(() => []),
    getStats: vi.fn(() => ({ totalMessages: 0, rooms: 0, subscribers: 0, initialized: true, drops: {} })),
  },
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, execSync: () => 'UNKNOWN' }
})

// Stub a gateway token so the channel check passes and we reach the bootstrap diagnosis.
vi.mock('../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config.js')>()
  return {
    ...actual,
    openclawConfig: {
      ...actual.openclawConfig,
      gatewayToken: 'test-token',
      gatewayUrl: 'ws://localhost:18789',
    },
  }
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /host/status + /doctor — bootstrap status honesty', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  // ── Proof 1: todo bootstrap task → BOOTSTRAP_NOT_STARTED ─────────────────
  it('/host/status: bootstrap task in todo → BOOTSTRAP_NOT_STARTED, not BOOTSTRAP_IN_PROGRESS', async () => {
    // Create a bootstrap task in todo status (mimics first-boot state before main agent runs)
    const cr = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        title: 'Bootstrap your team from the user\'s intent',
        description: 'First-boot bootstrap task',
        status: 'todo',
        assignee: 'main',
        priority: 'P0',
        createdBy: 'system',
        eta: '30m',
        done_criteria: ['TEAM-ROLES.yaml written'],
      },
    })
    expect(cr.statusCode).toBe(200)
    const bootstrapTask = JSON.parse(cr.body).task
    expect(bootstrapTask.status).toBe('todo')

    const res = await app.inject({ method: 'GET', url: '/host/status' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    // bootstrap.status should reflect the task status
    expect(body.bootstrap.status).toBe('todo')

    // stalled_reason must NOT say "in_progress" for a todo task
    expect(body.bootstrap.stalled_reason).toBe('bootstrap_task_not_started')
    expect(body.bootstrap.stalled_reason).not.toBe('bootstrap_task_in_progress')

    // diagnosis must NOT say "BOOTSTRAP_IN_PROGRESS" for a todo task
    expect(body.diagnosis.code).toBe('BOOTSTRAP_NOT_STARTED')
    expect(body.diagnosis.code).not.toBe('BOOTSTRAP_IN_PROGRESS')

    // Action must guide operator to check the agent, not "wait"
    expect(body.diagnosis.next_action).toMatch(/agent/)
    expect(body.diagnosis.next_action).not.toMatch(/wait/i)
  })

  // ── Proof 2: /doctor aligns with /host/status for todo task ──────────────
  it('/doctor: bootstrap task in todo → warn with honest message, no "in progress"', async () => {
    const res = await app.inject({ method: 'GET', url: '/doctor' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    const bootstrapDiag = body.diagnoses.find((d: { area: string }) => d.area === 'bootstrap')
    expect(bootstrapDiag).toBeDefined()

    // Should warn, not fail (task exists, just not claimed)
    expect(bootstrapDiag.status).toBe('warn')

    // Message must not say "in progress" — nothing is running
    expect(bootstrapDiag.message).not.toMatch(/in progress/i)
    expect(bootstrapDiag.message).toMatch(/not yet claimed|not.*started/i)
  })

  // ── Proof 3: doing bootstrap task → BOOTSTRAP_IN_PROGRESS unchanged ───────
  it('/host/status: bootstrap task in doing → BOOTSTRAP_IN_PROGRESS unchanged', async () => {
    // Find the bootstrap task created in proof 1 and move it to doing
    const listRes = await app.inject({ method: 'GET', url: '/tasks?status=todo' })
    const tasks = JSON.parse(listRes.body).tasks ?? JSON.parse(listRes.body)
    const bootstrapTask = (Array.isArray(tasks) ? tasks : tasks.tasks ?? []).find(
      (t: { title?: string; assignee?: string }) =>
        t.title?.includes('Bootstrap your team') && t.assignee === 'main'
    )
    expect(bootstrapTask).toBeDefined()

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${bootstrapTask.id}`,
      payload: { status: 'doing', metadata: { eta: '30m', wip_override: 'test' } },
    })
    expect(patchRes.statusCode).toBe(200)

    const res = await app.inject({ method: 'GET', url: '/host/status' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    // bootstrap.status should now be doing
    expect(body.bootstrap.status).toBe('doing')

    // stalled_reason should be in_progress for doing
    expect(body.bootstrap.stalled_reason).toBe('bootstrap_task_in_progress')

    // diagnosis should still be BOOTSTRAP_IN_PROGRESS for doing
    expect(body.diagnosis.code).toBe('BOOTSTRAP_IN_PROGRESS')
    expect(body.diagnosis.next_action).toMatch(/wait|running/i)
  })
})
