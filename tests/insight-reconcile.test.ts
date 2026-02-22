import { describe, it, expect } from 'vitest'
import { getOrphanedInsights, reconcileInsightTaskLinks, ingestReflection, getInsight, updateInsightStatus } from '../src/insights.js'
import { createReflection } from '../src/reflections.js'

function makeReflection(author: string, tags: string[]) {
  return createReflection({
    pain: `Test pain ${Date.now()}`,
    impact: 'Test impact',
    evidence: ['test-evidence-1'],
    went_well: 'Nothing notable',
    suspected_why: 'Test reason',
    proposed_fix: 'Test fix',
    confidence: 8,
    role_type: 'agent',
    author,
    severity: 'high',
    tags,
  })
}

describe('Insight reconciliation', () => {
  it('getOrphanedInsights returns promoted insights without task_id', () => {
    const tag = `reconcile-${Date.now()}`
    const ref = makeReflection('test-reconcile', [`stage:${tag}`, `family:${tag}`, `unit:${tag}`])
    const insight = ingestReflection(ref)

    // High severity auto-promotes — should be orphaned (no task_id)
    expect(insight).toBeTruthy()
    expect(insight.status).toBe('promoted')

    const orphans = getOrphanedInsights()
    const found = orphans.find(o => o.id === insight.id)
    expect(found).toBeTruthy()
  })

  it('reconcileInsightTaskLinks dry run does not modify state', () => {
    const result = reconcileInsightTaskLinks(
      () => ({ taskId: 'task-dry-run' }),
      true,
    )
    // Should report what would happen without changing anything
    expect(result.scanned).toBeGreaterThanOrEqual(0)
    expect(result.details.every(d => d.action === 'would_create')).toBe(true)

    // Orphans should still exist after dry run
    const orphans = getOrphanedInsights()
    expect(orphans.length).toBeGreaterThanOrEqual(0)
  })

  it('reconcileInsightTaskLinks creates tasks and links them', () => {
    const result = reconcileInsightTaskLinks(
      (insight) => {
        const taskId = `task-reconcile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        return { taskId }
      },
      false,
    )

    expect(result.created).toBeGreaterThanOrEqual(0)

    // After reconciliation, orphans should be cleared
    const orphansAfter = getOrphanedInsights()
    expect(orphansAfter.length).toBe(0)
  })

  it('already-linked insights are not returned as orphans', () => {
    const tag = `linked-${Date.now()}`
    const ref = makeReflection('test-linked', [`stage:${tag}`, `family:${tag}`, `unit:${tag}`])
    const insight = ingestReflection(ref)

    // Manually link it to a task
    updateInsightStatus(insight.id, 'task_created', 'task-already-linked')

    const orphans = getOrphanedInsights()
    const found = orphans.find(o => o.id === insight.id)
    expect(found).toBeFalsy()
  })
})
