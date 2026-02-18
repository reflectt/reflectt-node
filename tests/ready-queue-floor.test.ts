// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from 'vitest'
import { taskManager } from '../src/tasks.js'
import { policyManager } from '../src/policy.js'

describe('Ready-Queue Floor', () => {
  beforeEach(() => {
    // Ensure policy has readyQueueFloor enabled
    const policy = policyManager.get()
    expect(policy.readyQueueFloor).toBeDefined()
    expect(policy.readyQueueFloor.enabled).toBe(true)
    expect(policy.readyQueueFloor.minReady).toBe(2)
    expect(policy.readyQueueFloor.agents).toContain('link')
  })

  it('should have readyQueueFloor in default policy', () => {
    const policy = policyManager.get()
    expect(policy.readyQueueFloor).toMatchObject({
      enabled: true,
      minReady: 2,
      agents: ['link'],
      escalateAfterMin: 60,
      cooldownMin: 30,
      channel: 'general',
    })
  })

  it('should count unblocked todo tasks for monitored agents', () => {
    // Create test tasks
    const t1 = taskManager.createTask({
      title: 'TEST: ready-queue task 1',
      assignee: 'link',
      status: 'todo',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'sage',
    })
    const t2 = taskManager.createTask({
      title: 'TEST: ready-queue task 2',
      assignee: 'link',
      status: 'todo',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'sage',
    })

    const todoTasks = taskManager.listTasks({ status: 'todo', assignee: 'link' })
    const testTasks = todoTasks.filter(t => t.title?.startsWith('TEST: ready-queue'))
    expect(testTasks.length).toBeGreaterThanOrEqual(2)

    // Cleanup
    taskManager.deleteTask(t1.id)
    taskManager.deleteTask(t2.id)
  })

  it('should detect blocked tasks via metadata.blocked_by', () => {
    const blocker = taskManager.createTask({
      title: 'TEST: blocker task',
      assignee: 'pixel',
      status: 'todo',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'sage',
    })

    const blocked = taskManager.createTask({
      title: 'TEST: blocked task',
      assignee: 'link',
      status: 'todo',
      done_criteria: ['done'],
      createdBy: 'test',
      reviewer: 'sage',
    })

    // Set blocked_by via update
    taskManager.updateTask(blocked.id, { metadata: { blocked_by: blocker.id } })

    // Verify blocked_by is set
    const updated = taskManager.getTask(blocked.id)
    expect(updated?.metadata?.blocked_by).toBe(blocker.id)

    // Verify blocker is still open (not done)
    const blockerTask = taskManager.getTask(blocker.id)
    expect(blockerTask?.status).not.toBe('done')

    // Cleanup
    taskManager.deleteTask(blocked.id)
    taskManager.deleteTask(blocker.id)
  })

  it('should include escalateAfterMin in policy config', () => {
    const policy = policyManager.get()
    expect(policy.readyQueueFloor.escalateAfterMin).toBe(60)
  })

  it('should allow policy patching of readyQueueFloor', () => {
    const original = policyManager.get()
    const originalMin = original.readyQueueFloor.minReady

    // Patch to different value
    policyManager.patch({ readyQueueFloor: { minReady: 3 } } as any)
    const patched = policyManager.get()
    expect(patched.readyQueueFloor.minReady).toBe(3)

    // Restore
    policyManager.patch({ readyQueueFloor: { minReady: originalMin } } as any)
    const restored = policyManager.get()
    expect(restored.readyQueueFloor.minReady).toBe(originalMin)
  })
})
