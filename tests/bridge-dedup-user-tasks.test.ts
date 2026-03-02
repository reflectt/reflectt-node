// Tests that the insight-task bridge deduplicates against user-created tasks,
// not just bridge-created tasks.
//
// Regression: previously findExistingTaskForInsight only checked cluster_key
// for tasks with meta.source === 'insight-task-bridge'. User-created tasks and
// tasks from other sources were skipped, causing duplicate task creation when
// a validation reflection clustered to the same key as a closed user task.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import { createReflection } from '../src/reflections.js'
import { ingestReflection, getInsight, updateInsightStatus } from '../src/insights.js'
import { taskManager } from '../src/tasks.js'
import {
  _findExistingTaskForInsight,
  _handlePromotedInsight,
  _resetBridgeStats,
  getInsightTaskBridgeStats,
} from '../src/insight-task-bridge.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
  await new Promise(r => setTimeout(r, 200))
})

afterAll(async () => {
  await app.close()
})

function uniqueCluster(suffix = '') {
  return `test::dedup-user-task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${suffix}`
}

describe('Bridge dedup: user-created tasks (non-bridge source)', () => {
  it('findExistingTaskForInsight matches a done user-created task with same cluster_key', async () => {
    const clusterKey = uniqueCluster()
    const uniqueFamily = `dedup-user-${Date.now()}`

    // 1. Create a reflection → insight with a specific cluster
    const ref = createReflection({
      pain: 'Original bug was fixed',
      impact: 'Users unblocked',
      evidence: [`cluster:${clusterKey}`],
      went_well: 'Fixed cleanly',
      suspected_why: 'Known root cause',
      proposed_fix: 'Applied fix',
      confidence: 8,
      role_type: 'agent',
      author: `test-agent-${Math.random().toString(36).slice(2, 6)}`,
      severity: 'high',
      tags: [`stage:test`, `family:${uniqueFamily}`, `unit:dedup`],
    })
    const originalInsight = ingestReflection(ref)

    // 2. Create a user task (NOT from bridge) that references this insight
    const userTask = await taskManager.createTask({
      title: `[User] Fix for ${clusterKey}`,
      description: 'User-created task linked to insight',
      status: 'done',
      priority: 'P1',
      assignee: 'link',
      reviewer: 'sage',
      createdBy: 'user',
      done_criteria: ['fixed'],
      metadata: {
        insight_id: originalInsight.id,
        // NOTE: no source: 'insight-task-bridge' — this is the regression case
      },
    })

    // 3. Create a new insight with the same cluster_key (e.g., from a validation reflection)
    const followUpRef = createReflection({
      pain: 'Writing validation reflection for completed work',
      impact: 'Confirmation of fix',
      evidence: [`cluster:${clusterKey}`, `task:${userTask.id}`],
      went_well: 'Fix verified working',
      suspected_why: 'Same root cause, now closed',
      proposed_fix: 'Already fixed',
      confidence: 9,
      role_type: 'agent',
      author: `test-agent-${Math.random().toString(36).slice(2, 6)}`,
      severity: 'high',
      tags: [`stage:test`, `family:${uniqueFamily}`, `unit:dedup`],
    })
    const followUpInsight = ingestReflection(followUpRef)

    // Force same cluster_key on the follow-up insight for deterministic testing
    // (in production the clusterer would do this; here we simulate it)
    const db = (app as any).db || (await import('../src/db.js')).getDb()
    db.prepare('UPDATE insights SET cluster_key = ? WHERE id = ?').run(clusterKey, followUpInsight.id)

    // 4. findExistingTaskForInsight should find the user-created done task
    const updatedFollowUp = getInsight(followUpInsight.id)!
    updatedFollowUp.cluster_key = clusterKey  // reflect the forced update

    const match = _findExistingTaskForInsight(updatedFollowUp)
    expect(match).not.toBeNull()
    expect(match!.id).toBe(userTask.id)
    expect(match!.alreadyAddressed).toBe(true)
  })

  it('does NOT create duplicate task when done user-created task covers same cluster', async () => {
    const clusterKey = uniqueCluster('-nodupe')
    const uniqueFamily = `dedup-nodupe-${Date.now()}`

    // 1. Create original insight
    const ref = createReflection({
      pain: 'Bug was already fixed',
      impact: 'Fixed',
      evidence: [`cluster:${clusterKey}`],
      went_well: 'Works',
      suspected_why: 'Fixed',
      proposed_fix: 'Already done',
      confidence: 8,
      role_type: 'agent',
      author: `test-agent-${Math.random().toString(36).slice(2, 6)}`,
      severity: 'high',
      tags: [`stage:test`, `family:${uniqueFamily}`, `unit:nodupe`],
    })
    const originalInsight = ingestReflection(ref)
    updateInsightStatus(originalInsight.id, 'task_created', 'task-existing-user-task')

    // 2. Create a user task linked to the original insight (done)
    await taskManager.createTask({
      title: `[User] Already done for ${clusterKey}`,
      description: 'Already closed task',
      status: 'done',
      priority: 'P1',
      assignee: 'link',
      reviewer: 'sage',
      createdBy: 'user',
      done_criteria: ['done'],
      metadata: {
        insight_id: originalInsight.id,
        // No source: 'insight-task-bridge'
      },
    })

    // 3. Create a follow-up insight (e.g. from validation reflection) with same cluster
    const followUpRef = createReflection({
      pain: 'Validation: same issue confirmed fixed',
      impact: 'Confirmed',
      evidence: [`cluster:${clusterKey}`],
      went_well: 'All good',
      suspected_why: 'Same cluster',
      proposed_fix: 'None needed',
      confidence: 9,
      role_type: 'agent',
      author: `test-agent-${Math.random().toString(36).slice(2, 6)}`,
      severity: 'high',
      tags: [`stage:test`, `family:${uniqueFamily}`, `unit:nodupe`],
    })
    const followUpInsight = ingestReflection(followUpRef)

    // Force cluster_key to match
    const { getDb } = await import('../src/db.js')
    const db = getDb()
    db.prepare('UPDATE insights SET cluster_key = ? WHERE id = ?').run(clusterKey, followUpInsight.id)

    // Promote follow-up insight — bridge should dedup and NOT create a task
    _resetBridgeStats()
    const statsBefore = getInsightTaskBridgeStats()
    const createdBefore = statsBefore.tasksAutoCreated

    await _handlePromotedInsight({
      id: `evt-test-${Date.now()}`,
      type: 'system',
      source: 'test',
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: followUpInsight.id },
    })

    const statsAfter = getInsightTaskBridgeStats()
    expect(statsAfter.tasksAutoCreated).toBe(createdBefore)
    expect(statsAfter.duplicatesSkipped).toBeGreaterThan(0)
  })
})
