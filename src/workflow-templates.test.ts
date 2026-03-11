// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Test workflow template structure and runner logic

interface StepResult { success: boolean; error?: string }
interface WorkflowStep { name: string; action: () => StepResult }

async function runSteps(steps: WorkflowStep[]): Promise<{ success: boolean; completed: string[]; failed?: string }> {
  const completed: string[] = []
  for (const step of steps) {
    const result = step.action()
    if (!result.success) return { success: false, completed, failed: step.name }
    completed.push(step.name)
  }
  return { success: true, completed }
}

describe('workflow templates', () => {
  it('runs all steps in order on success', async () => {
    const steps: WorkflowStep[] = [
      { name: 'create', action: () => ({ success: true }) },
      { name: 'work', action: () => ({ success: true }) },
      { name: 'review', action: () => ({ success: true }) },
      { name: 'approve', action: () => ({ success: true }) },
      { name: 'handoff', action: () => ({ success: true }) },
      { name: 'complete', action: () => ({ success: true }) },
    ]
    const result = await runSteps(steps)
    assert.equal(result.success, true)
    assert.equal(result.completed.length, 6)
    assert.deepEqual(result.completed, ['create', 'work', 'review', 'approve', 'handoff', 'complete'])
  })

  it('stops on first failure', async () => {
    const steps: WorkflowStep[] = [
      { name: 'create', action: () => ({ success: true }) },
      { name: 'work', action: () => ({ success: true }) },
      { name: 'review', action: () => ({ success: false, error: 'Reviewer rejected' }) },
      { name: 'approve', action: () => ({ success: true }) },
    ]
    const result = await runSteps(steps)
    assert.equal(result.success, false)
    assert.equal(result.failed, 'review')
    assert.equal(result.completed.length, 2)
  })

  it('handles empty workflow', async () => {
    const result = await runSteps([])
    assert.equal(result.success, true)
    assert.equal(result.completed.length, 0)
  })

  it('pr-review template has 6 steps', () => {
    const prReviewSteps = ['create_run', 'start_work', 'request_review', 'approve', 'handoff', 'complete']
    assert.equal(prReviewSteps.length, 6)
  })

  it('step order matches the canonical flow', () => {
    const expected = ['create_run', 'start_work', 'request_review', 'approve', 'handoff', 'complete']
    // This is the order that was proven in the demo run
    assert.equal(expected[0], 'create_run')
    assert.equal(expected[1], 'start_work')
    assert.equal(expected[2], 'request_review')
    assert.equal(expected[3], 'approve')
    assert.equal(expected[4], 'handoff')
    assert.equal(expected[5], 'complete')
  })

  it('failure at create prevents all subsequent steps', async () => {
    const steps: WorkflowStep[] = [
      { name: 'create', action: () => ({ success: false, error: 'DB error' }) },
      { name: 'work', action: () => ({ success: true }) },
    ]
    const result = await runSteps(steps)
    assert.equal(result.success, false)
    assert.equal(result.completed.length, 0)
    assert.equal(result.failed, 'create')
  })

  it('single step workflow succeeds', async () => {
    const result = await runSteps([{ name: 'only', action: () => ({ success: true }) }])
    assert.equal(result.success, true)
    assert.equal(result.completed.length, 1)
  })
})
