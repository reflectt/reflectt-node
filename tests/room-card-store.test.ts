// Reply-card backfill v0: ring-buffer store unit tests. The Realtime
// channel hookup is exercised indirectly via the public API surface
// (_testInjectCardEntry stands in for incoming broadcasts so we don't
// need a live Supabase client in tests).

import { describe, it, expect, beforeEach } from 'vitest'
import {
  getRecentCards,
  getRoomCardStatus,
  _testInjectCardEntry,
  _testResetCardStore,
  type RoomCardEntry,
} from '../src/room-card-store.js'

function makeEntry(overrides: Partial<RoomCardEntry> & { serverTs: number; receivedAt?: number }): RoomCardEntry {
  return {
    senderParticipantId: overrides.senderParticipantId ?? 'p-asker',
    senderUserId: overrides.senderUserId ?? 'u-asker',
    card: overrides.card ?? {
      id: `card-${overrides.serverTs}`,
      type: 'response',
      agentId: 'compass',
      agentColor: '#abc',
      data: { text: 'hello' },
      arrivedAt: overrides.serverTs,
      serverTs: overrides.serverTs,
    },
    receivedAt: overrides.receivedAt ?? Date.now(),
  }
}

describe('room-card-store', () => {
  beforeEach(() => {
    _testResetCardStore()
  })

  it('returns the full ring when no since/limit provided', () => {
    _testInjectCardEntry(makeEntry({ serverTs: 1 }))
    _testInjectCardEntry(makeEntry({ serverTs: 2 }))
    const got = getRecentCards()
    expect(got).toHaveLength(2)
    expect(got[0]!.card.serverTs).toBe(1)
    expect(got[1]!.card.serverTs).toBe(2)
  })

  it('dedupes by serverTs — duplicate replaces existing rather than stacks', () => {
    const t1 = Date.now() - 5000
    const t2 = Date.now()
    _testInjectCardEntry(makeEntry({ serverTs: 99, receivedAt: t1 }))
    _testInjectCardEntry(makeEntry({ serverTs: 99, receivedAt: t2 }))
    const got = getRecentCards()
    expect(got).toHaveLength(1)
    expect(got[0]!.receivedAt).toBe(t2)
  })

  it('filters by sinceMs (inclusive)', () => {
    const now = Date.now()
    _testInjectCardEntry(makeEntry({ serverTs: 1, receivedAt: now - 10_000 }))
    _testInjectCardEntry(makeEntry({ serverTs: 2, receivedAt: now - 1000 }))
    const got = getRecentCards({ sinceMs: now - 5000 })
    expect(got).toHaveLength(1)
    expect(got[0]!.card.serverTs).toBe(2)
  })

  it('caps to limit from the END (newest entries)', () => {
    for (let i = 1; i <= 5; i++) {
      _testInjectCardEntry(makeEntry({ serverTs: i, receivedAt: Date.now() + i }))
    }
    const got = getRecentCards({ limit: 2 })
    expect(got).toHaveLength(2)
    expect(got.map((e) => e.card.serverTs)).toEqual([4, 5])
  })

  it('prunes entries older than the rolling window on read', () => {
    const now = Date.now()
    // Window is 10min; inject one entry well outside, one inside.
    _testInjectCardEntry(makeEntry({ serverTs: 1, receivedAt: now - 11 * 60_000 }))
    _testInjectCardEntry(makeEntry({ serverTs: 2, receivedAt: now }))
    const got = getRecentCards()
    expect(got).toHaveLength(1)
    expect(got[0]!.card.serverTs).toBe(2)
  })

  it('reports status with bufferedCount + totalReceived diagnostics', () => {
    _testInjectCardEntry(makeEntry({ serverTs: 1 }))
    _testInjectCardEntry(makeEntry({ serverTs: 2 }))
    _testInjectCardEntry(makeEntry({ serverTs: 1 }))  // dedupe — bufferedCount stays 2
    const status = getRoomCardStatus()
    expect(status.bufferedCount).toBe(2)
    expect(status.totalReceived).toBe(3)  // diagnostics count every receive, including dedupes
    expect(status.windowMs).toBe(10 * 60_000)
    expect(status.maxEntries).toBe(50)
  })
})
