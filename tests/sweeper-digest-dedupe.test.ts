// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getDb } from '../src/db.js'

// Keep this test unit-level: mock out chat + preflight so we can assert digest suppression.
const sendMessage = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('../src/chat.js', () => ({
  chatManager: {
    sendMessage,
  },
}))

vi.mock('../src/alert-preflight.js', () => ({
  preflightCheck: () => ({
    proceed: true,
    reason: undefined,
    latencyMs: 0,
    idempotentKey: 'test',
    mode: 'enforce',
  }),
}))

// executionSweeper imports a bunch of modules; stub anything that could do real work.
vi.mock('../src/tasks.js', () => ({
  taskManager: {
    getTask: () => undefined,
    getTaskComments: () => [],
    listTasks: () => [],
    resolveTaskId: () => ({ task: undefined, canonicalId: undefined }),
    patchTaskMetadata: () => {},
    updateTask: async () => {},
  },
}))

vi.mock('../src/prAutoMerge.js', () => ({
  processAutoMerge: async () => ({ closed: 0, reopened: 0 }),
  generateRemediation: () => '',
}))

vi.mock('../src/assignment.js', () => ({
  suggestReviewer: () => ({ suggested: '', scores: [] }),
}))

vi.mock('../src/duplicateClosureGuard.js', () => ({
  getDuplicateClosureCanonicalRefError: () => null,
}))

vi.mock('child_process', () => ({
  execSync: () => 'UNKNOWN',
}))

import {
  _escalateViolationsForTest,
  _resetSweeperDigestSuppressionForTest,
  type SweepViolation,
} from '../src/executionSweeper.js'

describe('Sweeper Digest dedupe/suppression', () => {
  beforeEach(() => {
    // Ensure persistent suppression ledger doesn't leak between tests
    const db = getDb()
    db.prepare('DELETE FROM suppression_ledger').run()

    _resetSweeperDigestSuppressionForTest()
    sendMessage.mockClear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-06T13:00:00.000Z'))
  })

  it('suppresses repeated identical digests within suppression window', async () => {
    const violations: SweepViolation[] = [
      {
        taskId: 'task-1',
        title: 'Test task',
        assignee: 'harmony',
        reviewer: 'sage',
        type: 'orphan_pr',
        age_minutes: 120,
        message: 'orphan',
      },
    ]

    await _escalateViolationsForTest(violations)
    await _escalateViolationsForTest(violations)

    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('re-emits digest after suppression window elapses', async () => {
    const violations: SweepViolation[] = [
      {
        taskId: 'task-1',
        title: 'Test task',
        assignee: 'harmony',
        reviewer: 'sage',
        type: 'orphan_pr',
        age_minutes: 120,
        message: 'orphan',
      },
    ]

    await _escalateViolationsForTest(violations)

    // Advance time past the 2h suppression window
    vi.setSystemTime(new Date('2026-03-06T15:00:01.000Z'))

    await _escalateViolationsForTest(violations)

    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it('suppresses identical digests across in-memory resets (persists across restarts)', async () => {
    const violations: SweepViolation[] = [
      {
        taskId: 'task-1',
        title: 'Test task',
        assignee: 'harmony',
        reviewer: 'sage',
        type: 'orphan_pr',
        age_minutes: 120,
        message: 'orphan',
      },
    ]

    await _escalateViolationsForTest(violations)

    // Simulate a process restart wiping the in-memory fingerprint cache
    _resetSweeperDigestSuppressionForTest()

    await _escalateViolationsForTest(violations)

    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('does not suppress when violation set changes (new fingerprint)', async () => {
    const v1: SweepViolation[] = [
      {
        taskId: 'task-1',
        title: 'Test task',
        assignee: 'harmony',
        reviewer: 'sage',
        type: 'orphan_pr',
        age_minutes: 120,
        message: 'orphan',
      },
    ]

    const v2: SweepViolation[] = [
      ...v1,
      {
        taskId: 'task-2',
        title: 'Another task',
        assignee: 'echo',
        reviewer: 'sage',
        type: 'validating_sla',
        age_minutes: 200,
        message: 'sla',
      },
    ]

    await _escalateViolationsForTest(v1)
    await _escalateViolationsForTest(v2)

    expect(sendMessage).toHaveBeenCalledTimes(2)
  })
})
