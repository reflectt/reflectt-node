// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from 'vitest'
import { SuppressionLedger } from '../src/suppression-ledger.js'
import { getDb } from '../src/db.js'

describe('Suppression Ledger', () => {
  let ledger: SuppressionLedger

  beforeEach(() => {
    // Clear ledger between tests
    const db = getDb()
    db.prepare('DELETE FROM suppression_ledger').run()
    ledger = new SuppressionLedger(30 * 60 * 1000) // 30m window
  })

  it('allows first message and returns dedup_key', () => {
    const result = ledger.check({
      category: 'watchdog-alert',
      channel: 'ops',
      from: 'system',
      content: '⚠️ Agent link idle for 45 minutes',
    })
    expect(result.isDuplicate).toBe(false)
    expect(result.dedup_key).toBeTruthy()
    expect(result.dedup_key.length).toBe(20)
  })

  it('detects duplicate within window', () => {
    const opts = {
      category: 'watchdog-alert',
      channel: 'ops',
      from: 'system',
      content: '⚠️ Agent link idle for 45 minutes',
    }

    const first = ledger.check(opts)
    expect(first.isDuplicate).toBe(false)

    const second = ledger.check(opts)
    expect(second.isDuplicate).toBe(true)
    expect(second.dedup_key).toBe(first.dedup_key)
    expect(second.existing).toBeDefined()
    expect(second.existing!.hit_count).toBe(2)
  })

  it('allows same content after window expires', () => {
    // Use a very short window for testing
    const shortLedger = new SuppressionLedger(1) // 1ms window

    const opts = {
      category: 'status-update',
      channel: 'general',
      from: 'system',
      content: 'Status: all systems operational',
    }

    shortLedger.check(opts)

    // Force the ledger entry to be old by directly updating DB
    const db = getDb()
    db.prepare('UPDATE suppression_ledger SET last_seen_at = last_seen_at - 10000').run()

    const result = shortLedger.check(opts)
    expect(result.isDuplicate).toBe(false)
  })

  it('generates different keys for different categories', () => {
    const base = {
      channel: 'ops',
      from: 'system',
      content: 'Same content here',
    }

    const key1 = ledger.computeDedupKey('watchdog-alert', base.channel, base.content)
    const key2 = ledger.computeDedupKey('status-update', base.channel, base.content)
    expect(key1).not.toBe(key2)
  })

  it('generates different keys for different channels', () => {
    const key1 = ledger.computeDedupKey('alert', 'ops', 'Same content')
    const key2 = ledger.computeDedupKey('alert', 'general', 'Same content')
    expect(key1).not.toBe(key2)
  })

  it('normalizes timestamps and task IDs in content', () => {
    const key1 = ledger.computeDedupKey('alert', 'ops', 'Task task-1772037188030-abc is overdue at 1772037188030')
    const key2 = ledger.computeDedupKey('alert', 'ops', 'Task task-9999999999999-xyz is overdue at 9999999999999')
    expect(key1).toBe(key2)
  })

  it('getStats returns correct counts', () => {
    const opts1 = { category: 'watchdog-alert', channel: 'ops', from: 'system', content: 'Alert 1' }
    const opts2 = { category: 'status-update', channel: 'general', from: 'system', content: 'Status 1' }

    ledger.check(opts1)
    ledger.check(opts1) // duplicate
    ledger.check(opts2)

    const stats = ledger.getStats()
    expect(stats.total_entries).toBe(2) // 2 unique
    expect(stats.total_suppressed).toBe(1) // 1 duplicate hit
    expect(stats.total_hits).toBe(3) // 1+2=3 total hits
    expect(stats.by_category['watchdog-alert']).toBeDefined()
    expect(stats.by_category['watchdog-alert'].hits).toBe(2)
    expect(stats.by_channel['ops']).toBeDefined()
    expect(stats.by_channel['general']).toBeDefined()
  })

  it('prune removes old entries', () => {
    ledger.check({ category: 'alert', channel: 'ops', from: 'system', content: 'Old alert' })

    // Make entry very old
    const db = getDb()
    db.prepare('UPDATE suppression_ledger SET last_seen_at = 1000').run()

    const pruned = ledger.prune()
    expect(pruned).toBe(1)

    const stats = ledger.getStats()
    expect(stats.total_entries).toBe(0)
  })

  it('persists across ledger instances', () => {
    const opts = { category: 'alert', channel: 'ops', from: 'system', content: 'Persistent check' }

    const ledger1 = new SuppressionLedger(30 * 60 * 1000)
    ledger1.check(opts)

    // New instance should see the entry
    const ledger2 = new SuppressionLedger(30 * 60 * 1000)
    const result = ledger2.check(opts)
    expect(result.isDuplicate).toBe(true)
  })
})
