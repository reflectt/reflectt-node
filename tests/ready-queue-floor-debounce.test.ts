// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { vi } from 'vitest'
import { policyManager } from '../src/policy.js'
import { boardHealthWorker } from '../src/boardHealthWorker.js'

// This test asserts the board-health worker suppresses transient ready-floor breaches.

describe('Ready-queue floor debounce (board health worker)', () => {
  it('does not emit ready-queue-warning until breach persists past debounce window', async () => {
    const agent = `debounce-test-${Math.random().toString(36).slice(2, 8)}`

    // Ensure deterministic time.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-26T12:00:00.000Z'))

    try {
      // Configure a short debounce window and zero cooldown for the test.
      policyManager.patch({
        continuityLoop: { enabled: false } as any,
        readyQueueFloor: {
          enabled: true,
          agents: [agent],
          minReady: 1,
          cooldownMin: 0,
          // @ts-expect-error: debounceMin is an additive field (runtime-merged)
          debounceMin: 5,
          escalateAfterMin: 9999,
          channel: 'ops',
        },
      } as any)

      // First tick: breach is newly observed, should be debounced.
      const first = await boardHealthWorker.tick({ dryRun: true, force: true })
      expect(first.actions.some(a => a.kind === 'ready-queue-warning')).toBe(false)

      // Advance just under debounce window — still suppressed.
      vi.setSystemTime(Date.now() + 4 * 60_000)
      const second = await boardHealthWorker.tick({ dryRun: true, force: true })
      expect(second.actions.some(a => a.kind === 'ready-queue-warning')).toBe(false)

      // Advance past debounce window — warning allowed.
      vi.setSystemTime(Date.now() + 2 * 60_000)
      const third = await boardHealthWorker.tick({ dryRun: true, force: true })
      expect(third.actions.some(a => a.kind === 'ready-queue-warning')).toBe(true)
    } finally {
      // Restore globals for other tests.
      policyManager.reset()
      vi.useRealTimers()
    }
  })
})
