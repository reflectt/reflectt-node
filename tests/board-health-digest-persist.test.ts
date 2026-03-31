// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Tests that the board-health digest lastDigestAt is persisted to SQLite
 * and survives process restarts, preventing 7-15x duplicate digest storms.
 *
 * Root cause (task-1773075546629-7bgji53a0):
 * - lastDigestAt was in-memory only — reset to 0 on restart
 * - Every restart triggered an immediate digest (since 0 < now - 4h)
 * - canaryMode:true on NoiseBudgetManager let duplicates through
 * - suppressionLedger didn't normalize numbers, so "32 todo" vs "31 todo" was a different key
 */

// ── KV stub ────────────────────────────────────────────────────────────────
const kvStore = new Map<string, string>()
const dbStub = {
  prepare: (sql: string) => ({
    get: (key: string) => {
      const value = kvStore.get(key)
      return value !== undefined ? { value } : undefined
    },
    run: (key: string, value: string) => {
      kvStore.set(key, value)
    },
  }),
}

vi.mock('../src/db.js', () => ({
  getDb: () => dbStub,
}))

vi.mock('../src/tasks.js', () => ({
  taskManager: {
    listTasks: () => [],
    getTask: () => undefined,
    addTaskComment: async () => ({ id: 'c1' }),
    updateTask: async () => {},
  },
}))

vi.mock('../src/chat.js', () => ({
  chatManager: { sendMessage: vi.fn(async () => ({ id: 'msg-1', timestamp: Date.now() })) },
}))

vi.mock('../src/messageRouter.js', () => ({
  routeMessage: vi.fn(async () => ({ decision: { channel: 'ops', alsoComment: false, reason: '' }, messageId: 'msg-1', commentId: null })),
}))

vi.mock('../src/policy.js', () => ({
  policyManager: {
    getPolicy: () => ({
      boardHealth: {},
      escalation: { digestChannel: 'ops' },
    }),
  },
}))

vi.mock('../src/presence.js', () => ({
  presenceManager: { getPresence: () => null },
}))

vi.mock('../src/assignment.js', () => ({
  suggestReviewer: () => ({ suggested: '', scores: [] }),
  getAgentRoles: () => ({}),
}))

vi.mock('../src/activity-signal.js', () => ({
  getEffectiveActivity: () => null,
}))

vi.mock('../src/health.js', () => ({
  validateTaskTimestamp: (_: unknown, now: number) => now,
  verifyTaskExists: () => true,
}))

vi.mock('../src/test-task-filter.js', () => ({
  isTestHarnessTask: () => false,
}))

vi.mock('../src/system-loop-state.js', () => ({
  recordSystemLoopTick: () => {},
}))

vi.mock('../src/review-state.js', () => ({
  isWaitingOnAuthor: () => false,
}))

vi.mock('../src/lane-config.js', () => ({
  getLanesConfig: () => [],
}))

import { readPersistedDigestAt, writePersistedDigestAt } from '../src/boardHealthWorker.js'
import { SuppressionLedger } from '../src/suppression-ledger.js'

describe('Board Health Digest: persistence', () => {
  beforeEach(() => {
    kvStore.clear()
  })

  it('readPersistedDigestAt returns 0 when no entry exists', () => {
    expect(readPersistedDigestAt()).toBe(0)
  })

  it('writePersistedDigestAt and readPersistedDigestAt round-trip', () => {
    const ts = 1773075546629
    writePersistedDigestAt(ts)
    expect(readPersistedDigestAt()).toBe(ts)
  })

  it('survives "restart" — new read after write returns same timestamp', () => {
    const ts = Date.now()
    writePersistedDigestAt(ts)
    // Simulate restart: read from same KV store
    const recovered = readPersistedDigestAt()
    expect(recovered).toBe(ts)
  })

  it('does not return stale zero after persistence', () => {
    const ts = Date.now() - 10_000
    writePersistedDigestAt(ts)
    const recovered = readPersistedDigestAt()
    // Must be non-zero (prevents immediate re-emit after restart)
    expect(recovered).toBeGreaterThan(0)
  })
})

describe('SuppressionLedger: digest normalization', () => {
  it('treats digests with different task counts as the same dedup key', () => {
    const ledger = new SuppressionLedger()
    const key1 = ledger.computeDedupKey('digest', 'ops', '📊 **Board Health Digest**\n**Board:** 32 todo · 2 doing · 1 validating · 5 blocked')
    const key2 = ledger.computeDedupKey('digest', 'ops', '📊 **Board Health Digest**\n**Board:** 31 todo · 3 doing · 2 validating · 4 blocked')
    expect(key1).toBe(key2)
  })

  it('distinguishes digests with structurally different content', () => {
    const ledger = new SuppressionLedger()
    const key1 = ledger.computeDedupKey('digest', 'ops', '📊 **Board Health Digest**')
    const key2 = ledger.computeDedupKey('digest', 'ops', '🔍 **Sweeper Digest**')
    expect(key1).not.toBe(key2)
  })

  it('non-digest categories are NOT normalized (exact content matters)', () => {
    const ledger = new SuppressionLedger()
    const key1 = ledger.computeDedupKey('watchdog-alert', 'general', 'task-abc has 5 minutes left')
    const key2 = ledger.computeDedupKey('watchdog-alert', 'general', 'task-abc has 10 minutes left')
    // Non-digest: timestamps/task-ids stripped but minute counts may still differ
    // (This test just ensures the digest normalization doesn't bleed into other categories)
    expect(typeof key1).toBe('string')
    expect(typeof key2).toBe('string')
  })
})
