// SPDX-License-Identifier: Apache-2.0
// Tests: insight dedup by source reflection
// Proves: two insights from the same reflection are detected as duplicates.

import { describe, it, expect, afterEach } from 'vitest'
import { taskManager } from '../src/tasks.js'
import { findExistingTaskForInsight } from '../src/insight-task-bridge.js'
import type { Insight } from '../src/insights.js'

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: 'ins-test-1',
    cluster_key: 'unknown::uncategorized::product-bugs',
    workflow_stage: 'unknown',
    failure_family: 'uncategorized',
    impacted_unit: 'product-bugs',
    title: 'uncategorized: Multiple product bugs hiding behind process noise',
    status: 'promoted',
    score: 10,
    priority: 'P0',
    reflection_ids: ['ref-shared-reflection-123'],
    independent_count: 1,
    evidence_refs: ['PR #572', 'PR #574'],
    authors: ['rhythm'],
    promotion_readiness: 'override',
    recurring_candidate: false,
    cooldown_until: null,
    cooldown_reason: null,
    severity_max: 'high',
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

describe('Insight dedup by source reflection', () => {
  const createdTaskIds: string[] = []

  afterEach(() => {
    for (const id of createdTaskIds) {
      try { taskManager.deleteTask(id) } catch { /* ok */ }
    }
    createdTaskIds.length = 0
  })

  it('detects duplicate when existing task shares the same source_reflection', async () => {
    // Create a task from the first insight (same source reflection)
    const task = await taskManager.createTask({
      title: '[Insight] First insight from shared reflection',
      status: 'done',
      assignee: 'sage',
      reviewer: 'rhythm',
      createdBy: 'insight-bridge',
      done_criteria: ['done'],
      metadata: {
        source: 'insight-task-bridge',
        insight_id: 'ins-first-insight',
        source_reflection: 'ref-shared-reflection-123',
      },
    })
    createdTaskIds.push(task.id)

    // Second insight from the same reflection but different cluster
    const secondInsight = makeInsight({
      id: 'ins-test-2',
      cluster_key: 'unknown::uncategorized::topic-process-automation-sweeper',
      title: 'uncategorized: Process automation generating noise',
      reflection_ids: ['ref-shared-reflection-123'],
    })

    const match = findExistingTaskForInsight(secondInsight)
    expect(match).not.toBeNull()
    expect(match!.id).toBe(task.id)
    expect(match!.alreadyAddressed).toBe(true)
  })

  it('does not flag as duplicate when reflections are different', async () => {
    const task = await taskManager.createTask({
      title: '[Insight] Unrelated insight',
      status: 'todo',
      assignee: 'sage',
      reviewer: 'rhythm',
      createdBy: 'insight-bridge',
      done_criteria: ['done'],
      metadata: {
        source: 'insight-task-bridge',
        insight_id: 'ins-unrelated',
        source_reflection: 'ref-different-reflection-456',
      },
    })
    createdTaskIds.push(task.id)

    const newInsight = makeInsight({
      id: 'ins-test-3',
      reflection_ids: ['ref-shared-reflection-123'],
    })

    // Should NOT match — different source_reflection
    const match = findExistingTaskForInsight(newInsight)
    // Could match on other criteria depending on test state, but not on reflection
    // The key assertion: if it matches, it shouldn't be because of reflection dedup
    if (match && match.id === task.id) {
      // This would be wrong — different reflections shouldn't match
      expect(true).toBe(false)
    }
  })
})
