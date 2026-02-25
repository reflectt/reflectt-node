// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { isTestHarnessTask } from '../src/test-task-filter.js'
import type { Task } from '../src/types.js'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-abc-123',
    title: overrides.title ?? 'Real production task',
    description: overrides.description ?? '',
    status: overrides.status ?? 'todo',
    assignee: overrides.assignee ?? 'link',
    reviewer: overrides.reviewer ?? 'kai',
    done_criteria: overrides.done_criteria ?? [],
    createdBy: overrides.createdBy ?? 'link',
    createdAt: overrides.createdAt ?? Date.now(),
    updatedAt: overrides.updatedAt ?? Date.now(),
    priority: overrides.priority ?? 'P2',
    metadata: overrides.metadata ?? {},
  } as Task
}

describe('isTestHarnessTask', () => {
  it('returns false for a normal production task', () => {
    expect(isTestHarnessTask(makeTask())).toBe(false)
  })

  it('returns true when metadata.is_test is true', () => {
    expect(isTestHarnessTask(makeTask({ metadata: { is_test: true } }))).toBe(true)
  })

  it('returns true when source_reflection starts with ref-test-', () => {
    expect(isTestHarnessTask(makeTask({
      metadata: { source_reflection: 'ref-test-12345' },
    }))).toBe(true)
  })

  it('returns true when source_insight starts with ins-test-', () => {
    expect(isTestHarnessTask(makeTask({
      metadata: { source_insight: 'ins-test-67890' },
    }))).toBe(true)
  })

  it('returns true when title matches "test run <timestamp>"', () => {
    expect(isTestHarnessTask(makeTask({
      title: 'Test run 1772037187994 validation',
    }))).toBe(true)
  })

  it('returns true when task ID starts with test-', () => {
    expect(isTestHarnessTask(makeTask({ id: 'test-harness-abc' }))).toBe(true)
  })

  it('returns true when task ID starts with task-test-', () => {
    expect(isTestHarnessTask(makeTask({ id: 'task-test-validation-001' }))).toBe(true)
  })

  it('returns false for TEST: title prefix (not auto-classified — use metadata.is_test)', () => {
    // TEST: prefix was a legacy convention; now handled only in board health inline checks
    expect(isTestHarnessTask(makeTask({ title: 'TEST: some harness task' }))).toBe(false)
  })

  it('returns false for tasks with "test" in the middle of the title', () => {
    expect(isTestHarnessTask(makeTask({ title: 'Add unit testing framework' }))).toBe(false)
  })

  it('returns false for task IDs with test in middle position', () => {
    expect(isTestHarnessTask(makeTask({ id: 'task-1772-attestation-xyz' }))).toBe(false)
  })

  it('returns false when metadata.is_test is false', () => {
    expect(isTestHarnessTask(makeTask({ metadata: { is_test: false } }))).toBe(false)
  })

  it('returns false when metadata.is_test is a string "true"', () => {
    expect(isTestHarnessTask(makeTask({ metadata: { is_test: 'true' } }))).toBe(false)
  })
})
