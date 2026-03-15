// SPDX-License-Identifier: Apache-2.0
// Validating-stall nudge tests
// Proves: POST /health/validating-nudge/tick fires a single direct nudge
// to the reviewer when a task is stale in validating, and is idempotent.

import { describe, it, expect, afterEach } from 'vitest'
import { taskManager } from '../src/tasks.js'

describe('POST /health/validating-nudge/tick', () => {
  const createdTaskIds: string[] = []
  let app: any

  afterEach(async () => {
    for (const id of createdTaskIds) {
      try { taskManager.deleteTask(id) } catch { /* ok */ }
    }
    createdTaskIds.length = 0
  })

  async function getApp() {
    if (!app) {
      const { createServer } = await import('../src/server.js')
      app = await createServer()
    }
    return app
  }

  async function createValidatingTask(overrides: Record<string, unknown> = {}) {
    const task = await taskManager.createTask({
      title: 'TEST: validating-nudge fixture',
      status: 'todo',
      assignee: 'test-agent',
      reviewer: 'sage',
      createdBy: 'test',
      done_criteria: ['Done'],
      metadata: {
        eta: '~1h',
        lane: 'ops',
        reflection_exempt: true,
        reflection_exempt_reason: 'test fixture',
        non_code: true,
        ...overrides,
      },
    })
    const shortId = task.id.split('-').pop()
    // Bypass HTTP gate — set validating directly via internal update
    taskManager.updateTask(task.id, {
      status: 'validating',
      metadata: {
        ...((task.metadata as Record<string, unknown>) || {}),
        ...overrides,
        non_code: true,
        artifact_path: `process/TASK-${shortId}.md`,
        entered_validating_at: (overrides.entered_validating_at as number) ?? (Date.now() - 35 * 60 * 1000),
      },
    })
    createdTaskIds.push(task.id)
    return taskManager.getTask(task.id)!
  }

  it('sends nudge for task stale in validating >30m with no review decision (dry-run)', async () => {
    const srv = await getApp()
    const task = await createValidatingTask()

    const res = await srv.inject({
      method: 'POST',
      url: '/health/validating-nudge/tick?dryRun=true&force=true',
    })

    const body = JSON.parse(res.body)
    expect(res.statusCode).toBe(200)
    expect(body.success).toBe(true)
    expect(body.nudged.length).toBeGreaterThanOrEqual(1)
    const hit = body.nudged.find((n: string) => n.includes(task.id))
    expect(hit).toBeDefined()
  })

  it('does not nudge task too young (<30m)', async () => {
    const srv = await getApp()
    const task = await createValidatingTask({
      entered_validating_at: Date.now() - 10 * 60 * 1000, // only 10m ago
    })

    const res = await srv.inject({
      method: 'POST',
      url: '/health/validating-nudge/tick?dryRun=true&force=true',
    })

    const body = JSON.parse(res.body)
    const nudgedIds = body.nudged.map((n: string) => n.split(':')[0].split('→')[0])
    expect(nudgedIds).not.toContain(task.id)
    const skippedForTask = body.skipped.find((s: string) => s.startsWith(task.id))
    expect(skippedForTask).toBeDefined()
    expect(skippedForTask).toMatch(/too_young/)
  })

  it('does not nudge task with review already approved', async () => {
    const srv = await getApp()
    const task = await createValidatingTask({ review_state: 'approved' })

    const res = await srv.inject({
      method: 'POST',
      url: '/health/validating-nudge/tick?dryRun=true&force=true',
    })

    const body = JSON.parse(res.body)
    const skippedForTask = body.skipped.find((s: string) => s.startsWith(task.id))
    expect(skippedForTask).toBeDefined()
    expect(skippedForTask).toMatch(/review_decided/)
  })

  it('does not nudge task already nudged (idempotent)', async () => {
    const srv = await getApp()
    const task = await createValidatingTask({
      validating_nudge_sent_at: Date.now() - 10 * 60 * 1000, // nudge already sent
    })

    const res = await srv.inject({
      method: 'POST',
      url: '/health/validating-nudge/tick?dryRun=true&force=true',
    })

    const body = JSON.parse(res.body)
    const skippedForTask = body.skipped.find((s: string) => s.startsWith(task.id))
    expect(skippedForTask).toBeDefined()
    expect(skippedForTask).toMatch(/already_nudged/)
  })

  it('sets validating_nudge_sent_at on task after real nudge', async () => {
    const srv = await getApp()
    const task = await createValidatingTask()

    // Verify not set before
    expect((task.metadata as any).validating_nudge_sent_at).toBeUndefined()

    await srv.inject({
      method: 'POST',
      url: '/health/validating-nudge/tick?force=true',
    })

    const updated = taskManager.getTask(task.id)!
    expect((updated.metadata as any).validating_nudge_sent_at).toBeDefined()
    expect(typeof (updated.metadata as any).validating_nudge_sent_at).toBe('number')
  })

  it('second tick does not nudge same task again', async () => {
    const srv = await getApp()
    const task = await createValidatingTask()

    // First tick
    await srv.inject({ method: 'POST', url: '/health/validating-nudge/tick?force=true' })

    // Second tick
    const res2 = await srv.inject({
      method: 'POST',
      url: '/health/validating-nudge/tick?dryRun=true&force=true',
    })

    const body2 = JSON.parse(res2.body)
    const nudgedIds2 = body2.nudged.map((n: string) => n.split('→')[0])
    expect(nudgedIds2).not.toContain(task.id)
    const skipped = body2.skipped.find((s: string) => s.startsWith(task.id))
    expect(skipped).toMatch(/already_nudged/)
  })

  it('respects custom threshold_ms param', async () => {
    const srv = await getApp()
    // Task is 35m old — should NOT nudge with 60m threshold
    const task = await createValidatingTask({
      entered_validating_at: Date.now() - 35 * 60 * 1000,
    })

    const res = await srv.inject({
      method: 'POST',
      url: '/health/validating-nudge/tick?dryRun=true&force=true&nudge_threshold_ms=3600000',
    })

    const body = JSON.parse(res.body)
    expect(body.nudge_threshold_ms).toBe(3600000)
    const nudgedIds = body.nudged.map((n: string) => n.split('→')[0])
    expect(nudgedIds).not.toContain(task.id)
  })
})
