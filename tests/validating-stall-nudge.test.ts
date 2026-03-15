// SPDX-License-Identifier: Apache-2.0
// Validating-stall nudge tests
// Proves: single DM to reviewer after 30m with no formal review action; no re-nudge on repeat tick.

import { describe, it, expect, afterEach } from 'vitest'
import { taskManager } from '../src/tasks.js'
import { healthMonitor } from '../src/health.js'

describe('validating-stall nudge', () => {
  const createdTaskIds: string[] = []

  afterEach(() => {
    for (const id of createdTaskIds) {
      try { taskManager.deleteTask(id) } catch { /* ok */ }
    }
    createdTaskIds.length = 0
  })

  async function createValidatingTask(overrides: Record<string, unknown> = {}) {
    const task = await taskManager.createTask({
      title: 'TEST: validating stall nudge',
      status: 'validating',
      assignee: 'link',
      reviewer: 'sage',
      createdBy: 'test',
      done_criteria: ['test'],
      metadata: {
        lane: 'engineering',
        artifact_path: 'process/TASK-test-nudge.md',
        reflection_exempt: true,
        reflection_exempt_reason: 'test fixture',
        ...overrides,
      },
    })
    createdTaskIds.push(task.id)
    return task
  }

  it('nudges reviewer when task is stale and no formal review decision', async () => {
    const now = Date.now()
    const thirtyOneMinsAgo = now - (31 * 60 * 1000)
    const task = await createValidatingTask({ entered_validating_at: thirtyOneMinsAgo })

    const result = await healthMonitor.runValidatingNudgeTick(now, {
      dryRun: true,
      nudgeThresholdMs: 30 * 60 * 1000,
    })

    expect(result.nudged.some(n => n.startsWith(task.id))).toBe(true)
  })

  it('skips task that is too young', async () => {
    const now = Date.now()
    const twentyNineMinsAgo = now - (29 * 60 * 1000)
    const task = await createValidatingTask({ entered_validating_at: twentyNineMinsAgo })

    const result = await healthMonitor.runValidatingNudgeTick(now, {
      dryRun: true,
      nudgeThresholdMs: 30 * 60 * 1000,
    })

    expect(result.nudged.some(n => n.startsWith(task.id))).toBe(false)
    expect(result.skipped.some(s => s.startsWith(task.id) && s.includes('too_young'))).toBe(true)
  })

  it('skips task already nudged (validating_nudge_sent_at set)', async () => {
    const now = Date.now()
    const task = await createValidatingTask({
      entered_validating_at: now - (45 * 60 * 1000),
      validating_nudge_sent_at: now - (10 * 60 * 1000),
    })

    const result = await healthMonitor.runValidatingNudgeTick(now, {
      dryRun: true,
      nudgeThresholdMs: 30 * 60 * 1000,
    })

    expect(result.nudged.some(n => n.startsWith(task.id))).toBe(false)
    expect(result.skipped.some(s => s.startsWith(task.id) && s.includes('already_nudged'))).toBe(true)
  })

  it('skips task with approved review_state', async () => {
    const now = Date.now()
    const task = await createValidatingTask({
      entered_validating_at: now - (45 * 60 * 1000),
      review_state: 'approved',
    })

    const result = await healthMonitor.runValidatingNudgeTick(now, {
      dryRun: true,
      nudgeThresholdMs: 30 * 60 * 1000,
    })

    expect(result.nudged.some(n => n.startsWith(task.id))).toBe(false)
    expect(result.skipped.some(s => s.startsWith(task.id) && s.includes('review_decided'))).toBe(true)
  })

  it('skips task with reviewer_approved=true', async () => {
    const now = Date.now()
    const task = await createValidatingTask({
      entered_validating_at: now - (45 * 60 * 1000),
      reviewer_approved: true,
    })

    const result = await healthMonitor.runValidatingNudgeTick(now, {
      dryRun: true,
      nudgeThresholdMs: 30 * 60 * 1000,
    })

    expect(result.nudged.some(n => n.startsWith(task.id))).toBe(false)
    expect(result.skipped.some(s => s.startsWith(task.id) && s.includes('review_decided'))).toBe(true)
  })

  it('stamps metadata.validating_nudge_sent_at after real send', async () => {
    const now = Date.now()
    const task = await createValidatingTask({
      entered_validating_at: now - (35 * 60 * 1000),
    })

    // Real run (not dry-run) — should stamp the task
    const result = await healthMonitor.runValidatingNudgeTick(now, {
      dryRun: false,
      nudgeThresholdMs: 30 * 60 * 1000,
    })

    expect(result.nudged.some(n => n.startsWith(task.id))).toBe(true)

    // Verify metadata was stamped
    const updated = taskManager.getTask(task.id)
    expect((updated?.metadata as any)?.validating_nudge_sent_at).toBeTruthy()

    // Second tick: same task should now be in skipped
    const result2 = await healthMonitor.runValidatingNudgeTick(now + 60_000, {
      dryRun: true,
      nudgeThresholdMs: 30 * 60 * 1000,
    })
    expect(result2.nudged.some(n => n.startsWith(task.id))).toBe(false)
    expect(result2.skipped.some(s => s.startsWith(task.id) && s.includes('already_nudged'))).toBe(true)
  })
})
