// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { describe, it, expect, beforeEach } from 'vitest'
import { scanScopeOverlap, scanAndNotify, _resetIdempotency, _getNotifiedKeys } from '../src/scopeOverlap.js'
import { taskManager } from '../src/tasks.js'
import { chatManager } from '../src/chat.js'

const BASE_TASK = {
  createdBy: 'test',
  done_criteria: ['Test criterion'],
}

describe('Scope Overlap Scanner', () => {
  beforeEach(() => {
    const all = taskManager.listTasks({})
    for (const t of all) {
      taskManager.deleteTask(t.id)
    }
  })

  it('returns empty matches when no open tasks exist', () => {
    const result = scanScopeOverlap(100, 'feat: add pulse endpoint', 'kai/pulse-endpoint')
    expect(result.matches).toHaveLength(0)
    expect(result.scanned).toBe(0)
  })

  it('detects title keyword overlap', async () => {
    await taskManager.createTask({
      ...BASE_TASK,
      title: 'Add pulse endpoint for team status',
      assignee: 'link',
      status: 'todo',
    })

    const result = scanScopeOverlap(100, 'feat: pulse endpoint implementation', 'kai/pulse-endpoint')
    expect(result.matches.length).toBeGreaterThan(0)
    expect(result.matches[0].assignee).toBe('link')
    expect(result.matches[0].matchReason).toContain('title overlap')
  })

  it('detects branch name overlap', async () => {
    const task = await taskManager.createTask({
      ...BASE_TASK,
      title: 'Unrelated task title here',
      assignee: 'pixel',
      status: 'todo',
      metadata: { branch: 'pixel/activity-timeline-ui-scaffold' },
    })

    const result = scanScopeOverlap(200, 'feat: activity timeline', 'link/activity-timeline-backend')
    const match = result.matches.find(m => m.taskId === task.id)
    expect(match).toBeDefined()
    expect(match!.matchReason).toContain('branch overlap')
  })

  it('detects insight_id match with high confidence', async () => {
    const mergedTask = await taskManager.createTask({
      ...BASE_TASK,
      title: 'Fix deployment drift merged version',
      assignee: 'kai',
      status: 'todo',
      metadata: { insight_id: 'ins-123' },
    })

    await taskManager.createTask({
      ...BASE_TASK,
      title: 'Different title entirely unique',
      assignee: 'echo',
      status: 'todo',
      metadata: { insight_id: 'ins-123' },
    })

    const result = scanScopeOverlap(300, 'fix: deployment drift', 'kai/fix-drift', mergedTask.id)
    const match = result.matches.find(m => m.assignee === 'echo')
    expect(match).toBeDefined()
    expect(match!.confidence).toBe('high')
    expect(match!.matchReason).toContain('same insight')
  })

  it('skips the merged task itself', async () => {
    const task = await taskManager.createTask({
      ...BASE_TASK,
      title: 'This task owns the merged PR exactly',
      assignee: 'kai',
      status: 'todo',
    })

    const result = scanScopeOverlap(400, 'This task owns the merged PR exactly', 'kai/owns-pr', task.id)
    expect(result.matches.find(m => m.taskId === task.id)).toBeUndefined()
  })

  it('does not match unrelated tasks', async () => {
    await taskManager.createTask({
      ...BASE_TASK,
      title: 'Fix billing webhook retry logic',
      assignee: 'link',
      status: 'todo',
    })

    const result = scanScopeOverlap(500, 'feat: activity timeline endpoint', 'kai/activity-timeline')
    expect(result.matches).toHaveLength(0)
  })

  it('sorts matches by confidence (high first)', async () => {
    const mergedTask = await taskManager.createTask({
      ...BASE_TASK,
      title: 'Original task implementation base',
      assignee: 'kai',
      status: 'todo',
      metadata: { insight_id: 'ins-456' },
    })

    await taskManager.createTask({
      ...BASE_TASK,
      title: 'High confidence same insight task',
      assignee: 'echo',
      status: 'todo',
      metadata: { insight_id: 'ins-456' },
    })

    await taskManager.createTask({
      ...BASE_TASK,
      title: 'Original task duplicate implementation base',
      assignee: 'link',
      status: 'todo',
    })

    const result = scanScopeOverlap(600, 'Original task implementation base', 'kai/original-task', mergedTask.id)
    if (result.matches.length >= 2) {
      expect(result.matches[0].confidence).toBe('high')
    }
  })

  it('includes todo tasks in scan', async () => {
    await taskManager.createTask({
      ...BASE_TASK,
      title: 'Add pulse snapshot feature endpoint',
      assignee: 'rhythm',
      status: 'todo',
    })

    const result = scanScopeOverlap(700, 'feat: pulse snapshot endpoint', 'kai/pulse-snapshot')
    expect(result.matches.length).toBeGreaterThan(0)
  })
})

describe('Scope Overlap Idempotency', () => {
  beforeEach(() => {
    _resetIdempotency()
    const all = taskManager.listTasks({})
    for (const t of all) {
      taskManager.deleteTask(t.id)
    }
  })

  it('sends notification on first call', async () => {
    // Create a task that will match
    await taskManager.createTask({
      ...BASE_TASK,
      title: 'Add pulse snapshot feature endpoint',
      assignee: 'rhythm',
      status: 'todo',
    })

    const before = chatManager.getMessages({}).length
    await scanAndNotify(800, 'feat: pulse snapshot endpoint', 'kai/pulse-snapshot')
    const after = chatManager.getMessages({}).length
    expect(after).toBeGreaterThan(before)
  })

  it('does NOT send duplicate notification on second call with same PR', async () => {
    // Create a task that will match
    await taskManager.createTask({
      ...BASE_TASK,
      title: 'Add pulse snapshot feature endpoint',
      assignee: 'rhythm',
      status: 'todo',
    })

    // First call — should notify
    await scanAndNotify(900, 'feat: pulse snapshot endpoint', 'kai/pulse-snapshot')
    const afterFirst = chatManager.getMessages({}).length

    // Second call — same PR, should NOT notify again
    await scanAndNotify(900, 'feat: pulse snapshot endpoint', 'kai/pulse-snapshot')
    const afterSecond = chatManager.getMessages({}).length

    expect(afterSecond).toBe(afterFirst)
  })

  it('tracks notified keys', async () => {
    await taskManager.createTask({
      ...BASE_TASK,
      title: 'Add pulse snapshot feature endpoint',
      assignee: 'rhythm',
      status: 'todo',
    })

    await scanAndNotify(1000, 'feat: pulse snapshot endpoint', 'kai/pulse-snapshot', 'task-123')
    const keys = _getNotifiedKeys()
    expect(keys.has('1000:task-123')).toBe(true)
  })

  it('allows notification for different PR numbers', async () => {
    await taskManager.createTask({
      ...BASE_TASK,
      title: 'Add pulse snapshot feature endpoint',
      assignee: 'rhythm',
      status: 'todo',
    })

    const before = chatManager.getMessages({}).length
    await scanAndNotify(1100, 'feat: pulse snapshot endpoint', 'kai/pulse-snapshot')
    const afterFirst = chatManager.getMessages({}).length
    expect(afterFirst).toBeGreaterThan(before)

    await scanAndNotify(1101, 'feat: pulse snapshot endpoint', 'kai/pulse-snapshot')
    const afterSecond = chatManager.getMessages({}).length
    expect(afterSecond).toBeGreaterThan(afterFirst)
  })
})
