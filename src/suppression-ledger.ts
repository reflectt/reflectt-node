// SPDX-License-Identifier: Apache-2.0
// Persistent suppression ledger for system message deduplication
//
// Tracks dedup keys (category + channel + content hash) in SQLite.
// Prevents duplicate system messages within a configurable window (default 30m).

import { createHash } from 'crypto'
import { getDb } from './db.js'

export interface SuppressionEntry {
  id: number
  dedup_key: string
  category: string
  channel: string
  from: string
  content_preview: string | null
  first_seen_at: number
  last_seen_at: number
  hit_count: number
  suppressed: boolean
  window_ms: number
}

export interface SuppressionCheckResult {
  isDuplicate: boolean
  dedup_key: string
  existing?: SuppressionEntry
}

export interface SuppressionStats {
  total_entries: number
  total_suppressed: number
  total_hits: number
  by_category: Record<string, { entries: number; suppressed: number; hits: number }>
  by_channel: Record<string, { entries: number; suppressed: number; hits: number }>
  window_ms: number
  active_entries: number
}

const DEFAULT_WINDOW_MS = 30 * 60 * 1000 // 30 minutes

export class SuppressionLedger {
  private windowMs: number

  constructor(windowMs?: number) {
    this.windowMs = windowMs ?? DEFAULT_WINDOW_MS
  }

  /**
   * Compute a dedup key from category + channel + content.
   * Content is normalized: timestamps, task IDs, and message IDs stripped.
   */
  computeDedupKey(category: string, channel: string, content: string): string {
    const normalized = content
      .trim()
      .toLowerCase()
      .replace(/\b(msg-|task-|tcomment-|ins-|ref-)\S+/g, '')
      .replace(/\d{13,}/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 300)
    const raw = `${category}:${channel}:${normalized}`
    return createHash('sha256').update(raw).digest('hex').substring(0, 20)
  }

  /**
   * Check if a message is a duplicate within the suppression window.
   * If not a duplicate, records it in the ledger.
   * If duplicate, increments the hit count and marks as suppressed.
   */
  check(opts: {
    category: string
    channel: string
    from: string
    content: string
  }): SuppressionCheckResult {
    const dedup_key = this.computeDedupKey(opts.category, opts.channel, opts.content)
    const now = Date.now()
    const db = getDb()

    interface LedgerRow {
      id: number
      dedup_key: string
      category: string
      channel: string
      from: string
      content_preview: string | null
      first_seen_at: number
      last_seen_at: number
      hit_count: number
      suppressed: number // SQLite stores as 0/1
      window_ms: number
    }

    const existing = db.prepare(
      'SELECT * FROM suppression_ledger WHERE dedup_key = ?'
    ).get(dedup_key) as LedgerRow | undefined

    if (existing && (now - existing.last_seen_at) < this.windowMs) {
      // Duplicate within window — update hit count
      db.prepare(
        'UPDATE suppression_ledger SET hit_count = hit_count + 1, last_seen_at = ?, suppressed = 1 WHERE dedup_key = ?'
      ).run(now, dedup_key)

      return {
        isDuplicate: true,
        dedup_key,
        existing: {
          ...existing,
          suppressed: true,
          hit_count: existing.hit_count + 1,
          last_seen_at: now,
        },
      }
    }

    // Not a duplicate (or outside window) — upsert
    db.prepare(`
      INSERT INTO suppression_ledger (dedup_key, category, channel, "from", content_preview, first_seen_at, last_seen_at, hit_count, suppressed, window_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
      ON CONFLICT(dedup_key) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        hit_count = 1,
        suppressed = 0,
        "from" = excluded."from",
        content_preview = excluded.content_preview,
        window_ms = excluded.window_ms
    `).run(dedup_key, opts.category, opts.channel, opts.from, opts.content.slice(0, 200), now, now, this.windowMs)

    return { isDuplicate: false, dedup_key }
  }

  /**
   * Get suppression statistics.
   */
  getStats(): SuppressionStats {
    const db = getDb()
    const now = Date.now()
    const activeCutoff = now - this.windowMs

    const total = (db.prepare('SELECT COUNT(*) as c FROM suppression_ledger').get() as { c: number }).c
    const totalSuppressed = (db.prepare('SELECT COUNT(*) as c FROM suppression_ledger WHERE suppressed = 1').get() as { c: number }).c
    const totalHitsRow = db.prepare('SELECT COALESCE(SUM(hit_count), 0) as s FROM suppression_ledger').get() as { s: number }
    const activeEntries = (db.prepare('SELECT COUNT(*) as c FROM suppression_ledger WHERE last_seen_at >= ?').get(activeCutoff) as { c: number }).c

    const byCatRows = db.prepare(`
      SELECT category,
        COUNT(*) as entries,
        SUM(CASE WHEN suppressed = 1 THEN 1 ELSE 0 END) as suppressed,
        SUM(hit_count) as hits
      FROM suppression_ledger GROUP BY category
    `).all() as Array<{ category: string; entries: number; suppressed: number; hits: number }>

    const byChannelRows = db.prepare(`
      SELECT channel,
        COUNT(*) as entries,
        SUM(CASE WHEN suppressed = 1 THEN 1 ELSE 0 END) as suppressed,
        SUM(hit_count) as hits
      FROM suppression_ledger GROUP BY channel
    `).all() as Array<{ channel: string; entries: number; suppressed: number; hits: number }>

    return {
      total_entries: total,
      total_suppressed: totalSuppressed,
      total_hits: totalHitsRow.s,
      by_category: Object.fromEntries(byCatRows.map(r => [r.category, { entries: r.entries, suppressed: r.suppressed, hits: r.hits }])),
      by_channel: Object.fromEntries(byChannelRows.map(r => [r.channel, { entries: r.entries, suppressed: r.suppressed, hits: r.hits }])),
      window_ms: this.windowMs,
      active_entries: activeEntries,
    }
  }

  /**
   * Prune old entries outside the window.
   */
  prune(): number {
    const db = getDb()
    const cutoff = Date.now() - this.windowMs * 10 // Keep 10x window for stats
    const result = db.prepare('DELETE FROM suppression_ledger WHERE last_seen_at < ?').run(cutoff)
    return result.changes
  }

  /**
   * Get window in ms.
   */
  getWindowMs(): number {
    return this.windowMs
  }

  /**
   * Update window.
   */
  setWindowMs(ms: number): void {
    this.windowMs = ms
  }
}

export const suppressionLedger = new SuppressionLedger()
