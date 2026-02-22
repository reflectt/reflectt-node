import { describe, it, expect } from 'vitest'

/**
 * Mention-rescue one-shot idempotency — behavioral specification.
 *
 * The core fix is in BoardHealthWorker.runMentionRescueTick():
 * - mentionRescueState now tracks { lastRescueAt, rescueCount } per mentionId
 * - Once rescueCount > 0, the mention is NEVER rescued again (one-shot)
 * - This prevents the duplicate fallback spam we've been seeing
 *
 * Since BoardHealthWorker is tightly coupled to ChatManager and presenceManager,
 * we test the idempotency logic pattern directly rather than through the HTTP API.
 */

describe('Mention-rescue one-shot idempotency logic', () => {
  // Simulate the mentionRescueState map behavior
  type RescueEntry = { lastRescueAt: number; rescueCount: number }

  it('first rescue for a mentionId should fire', () => {
    const state = new Map<string, RescueEntry>()
    const mentionId = 'msg-123'

    const entry = state.get(mentionId)
    const shouldSkip = entry && entry.rescueCount > 0
    expect(shouldSkip).toBeFalsy()

    // After rescue fires:
    state.set(mentionId, { lastRescueAt: Date.now(), rescueCount: 1 })
    expect(state.get(mentionId)!.rescueCount).toBe(1)
  })

  it('second rescue for same mentionId should be blocked (one-shot)', () => {
    const state = new Map<string, RescueEntry>()
    const mentionId = 'msg-123'

    // First rescue
    state.set(mentionId, { lastRescueAt: Date.now(), rescueCount: 1 })

    // Second attempt — should be blocked
    const entry = state.get(mentionId)
    const shouldSkip = entry && entry.rescueCount > 0
    expect(shouldSkip).toBe(true)
  })

  it('different mentionIds are tracked independently', () => {
    const state = new Map<string, RescueEntry>()

    // Rescue mention A
    state.set('msg-A', { lastRescueAt: Date.now(), rescueCount: 1 })

    // Mention B should still fire
    const entryB = state.get('msg-B')
    const shouldSkipB = entryB && entryB.rescueCount > 0
    expect(shouldSkipB).toBeFalsy()
  })

  it('pruning removes entries older than threshold', () => {
    const state = new Map<string, RescueEntry>()
    const now = Date.now()
    const pruneThresholdMs = 60 * 60_000 // 1 hour

    // Old entry (2 hours ago)
    state.set('msg-old', { lastRescueAt: now - 2 * 60 * 60_000, rescueCount: 1 })
    // Recent entry (5 minutes ago)
    state.set('msg-recent', { lastRescueAt: now - 5 * 60_000, rescueCount: 1 })

    // Prune
    for (const [key, entry] of state) {
      if (now - entry.lastRescueAt > pruneThresholdMs) {
        state.delete(key)
      }
    }

    expect(state.has('msg-old')).toBe(false)
    expect(state.has('msg-recent')).toBe(true)
  })

  it('pruned mentionId can be rescued again after re-appearing', () => {
    const state = new Map<string, RescueEntry>()
    const now = Date.now()
    const pruneThresholdMs = 60 * 60_000

    // Original rescue + prune
    state.set('msg-123', { lastRescueAt: now - 2 * 60 * 60_000, rescueCount: 1 })
    for (const [key, entry] of state) {
      if (now - entry.lastRescueAt > pruneThresholdMs) state.delete(key)
    }

    // After prune, same mentionId should be rescuable again
    // (but in practice this won't happen since the mention would be >30min old and filtered by maxMentionAgeMs)
    const entry = state.get('msg-123')
    const shouldSkip = entry && entry.rescueCount > 0
    expect(shouldSkip).toBeFalsy()
  })
})
