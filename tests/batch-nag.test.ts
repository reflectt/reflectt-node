/**
 * Batch-before-post gate — SIGNAL-ROUTING Change 4
 * task-1773525646527-rgpsta72u
 *
 * Validates that per-agent reflection + idle nags are batched into a single
 * digest post instead of N individual channel messages.
 *
 * WATCHDOG_BATCH_WINDOW_MS env var controls flush timing (default 5min; set to
 * a small value in tests).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── Mock routeMessage so we can capture what gets posted ─────────────────────
const postedMessages: Array<{ channel: string; content: string; category: string }> = []

vi.mock('../src/messageRouter.js', () => ({
  routeMessage: vi.fn(async (msg: any) => {
    postedMessages.push({ channel: msg.forceChannel ?? msg.channel ?? 'general', content: msg.content, category: msg.category ?? '' })
    return { sent: true }
  }),
}))

// ── Import after mock is set up ──────────────────────────────────────────────
import {
  getBatchWindowMs,
  _nagBatch,
  _flushNagBatch,
} from '../src/reflection-automation.js'

// ── Reset batch state before each test ──────────────────────────────────────
beforeEach(() => {
  postedMessages.length = 0
  _nagBatch.clear()
  process.env.WATCHDOG_BATCH_WINDOW_MS = '50' // fast flush for tests
})

afterEach(() => {
  delete process.env.WATCHDOG_BATCH_WINDOW_MS
})

// ── Helpers ──────────────────────────────────────────────────────────────────

async function waitMs(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SIGNAL-ROUTING Change 4: batch-before-post nag gate', () => {
  it('A: WATCHDOG_BATCH_WINDOW_MS env var is respected', () => {
    process.env.WATCHDOG_BATCH_WINDOW_MS = '1234'
    expect(getBatchWindowMs()).toBe(1234)
    delete process.env.WATCHDOG_BATCH_WINDOW_MS
    expect(getBatchWindowMs()).toBe(5 * 60 * 1000)
  })

  it('B: multiple nags within window accumulate in batch, not posted individually', async () => {
    // Directly push to _nagBatch to simulate batchNag() calls without side effects
    _nagBatch.set('ops', [
      '🪞 @link: 20h since last reflection',
      '🪞 @kai: completed "task-abc" — what went well?',
      '🪞 @pixel: idle 16h',
    ])

    // Before flush: nothing posted
    expect(postedMessages.length).toBe(0)

    // Flush
    _flushNagBatch()

    // After flush: exactly ONE digest post, not 3 individual posts
    expect(postedMessages.length).toBe(1)
    expect(postedMessages[0].content).toContain('Reflection & Idle Digest')
    expect(postedMessages[0].content).toContain('3 reminder')
    expect(postedMessages[0].content).toContain('@link')
    expect(postedMessages[0].content).toContain('@kai')
    expect(postedMessages[0].content).toContain('@pixel')
  })

  it('C: flush clears the batch (no double-post on second flush)', () => {
    _nagBatch.set('ops', ['🪞 @link: test message'])
    _flushNagBatch()
    expect(postedMessages.length).toBe(1)

    postedMessages.length = 0
    _flushNagBatch() // second flush — batch is empty
    expect(postedMessages.length).toBe(0)
  })

  it('D: separate channels produce separate digest posts', () => {
    _nagBatch.set('ops', ['🪞 @link: ops channel nag'])
    _nagBatch.set('general', ['🪞 @kai: general channel nag'])

    _flushNagBatch()

    expect(postedMessages.length).toBe(2)
    const channels = postedMessages.map(m => m.channel).sort()
    expect(channels).toEqual(['general', 'ops'])
  })

  it('E: single nag still produces digest format (not raw message)', () => {
    _nagBatch.set('ops', ['🪞 @link: only one nag'])
    _flushNagBatch()

    expect(postedMessages.length).toBe(1)
    expect(postedMessages[0].content).toContain('Reflection & Idle Digest')
    expect(postedMessages[0].content).toContain('1 reminder')
    // Does NOT post the raw message directly to channel
    expect(postedMessages[0].content).not.toBe('🪞 @link: only one nag')
  })
})
