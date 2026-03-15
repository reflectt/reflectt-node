// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

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
    // Return a live-looking task so the race-guard in escalateViolations()
    // does not filter out test violations (race-guard was added in PR #1034).
    resolveTaskId: (id: string) => ({
      task: { id, status: 'validating', metadata: {} },
      canonicalId: id,
    }),
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
  _computeDigestFingerprintForTest,
  _escalateViolationsForTest,
  _resetSweeperDigestSuppressionForTest,
  type SweepViolation,
} from '../src/executionSweeper.js'

describe('Sweeper Digest dedupe/suppression', () => {
  const baseViolation = (): SweepViolation => ({
    taskId: 'task-1',
    title: 'Test task',
    assignee: 'harmony',
    reviewer: 'sage',
    type: 'orphan_pr',
    age_minutes: 120,
    message: 'orphan',
  })

  beforeEach(() => {
    _resetSweeperDigestSuppressionForTest()
    sendMessage.mockClear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-06T13:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('computes a stable fingerprint from violation identity only', () => {
    const base = [baseViolation()]
    const reorderedWithChurn: SweepViolation[] = [
      {
        ...baseViolation(),
        title: 'Renamed task title should not matter',
        age_minutes: 999,
        message: 'different rendered copy should not matter',
      },
      {
        taskId: 'task-2',
        title: 'Second task',
        assignee: 'echo',
        reviewer: 'sage',
        type: 'validating_sla',
        age_minutes: 15,
        message: 'warning',
      },
    ]
    const canonical: SweepViolation[] = [
      {
        taskId: 'task-2',
        title: 'Another title entirely',
        assignee: 'echo',
        reviewer: 'sage',
        type: 'validating_sla',
        age_minutes: 16,
        message: 'same issue, different copy',
      },
      baseViolation(),
    ]

    expect(_computeDigestFingerprintForTest(reorderedWithChurn)).toBe(
      _computeDigestFingerprintForTest(canonical),
    )

    expect(_computeDigestFingerprintForTest(canonical)).not.toBe(
      _computeDigestFingerprintForTest([...canonical, {
        taskId: 'task-3',
        title: 'New issue',
        assignee: 'link',
        reviewer: 'sage',
        type: 'pr_drift',
        age_minutes: 200,
        message: 'new violation changes fingerprint',
      }]),
    )
  })

  it('suppresses repeated identical digests within suppression window', async () => {
    const violations: SweepViolation[] = [baseViolation()]

    await _escalateViolationsForTest(violations)
    await _escalateViolationsForTest(violations)

    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('re-emits digest after suppression window elapses', async () => {
    const violations: SweepViolation[] = [baseViolation()]

    await _escalateViolationsForTest(violations)

    // Advance time past the 2h suppression window
    vi.setSystemTime(new Date('2026-03-06T15:00:01.000Z'))

    await _escalateViolationsForTest(violations)

    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it('does not suppress when violation set changes (new fingerprint)', async () => {
    const v1: SweepViolation[] = [baseViolation()]

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
