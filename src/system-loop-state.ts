// SPDX-License-Identifier: Apache-2.0

/**
 * Persisted loop tick timestamps (SQLite) so /health/system can prove that
 * timers/watchdogs are actually firing (and not just configured).
 */

import { getDb } from './db.js'

export type SystemLoopName =
  | 'idle_nudge'
  | 'cadence_watchdog'
  | 'mention_rescue'
  | 'reflection_pipeline'
  | 'board_health'

export function recordSystemLoopTick(name: SystemLoopName, now = Date.now()): void {
  const db = getDb()
  try {
    db.prepare(
      `INSERT INTO system_loop_ticks (name, last_tick_at)
       VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET last_tick_at = excluded.last_tick_at`,
    ).run(name, now)
  } catch {
    // Best-effort: DB may be unavailable in some unit test contexts.
  }
}

export function getSystemLoopTicks(): Record<SystemLoopName, number> {
  const db = getDb()
  const out: Record<SystemLoopName, number> = {
    idle_nudge: 0,
    cadence_watchdog: 0,
    mention_rescue: 0,
    reflection_pipeline: 0,
    board_health: 0,
  }

  try {
    const rows = db.prepare('SELECT name, last_tick_at FROM system_loop_ticks').all() as Array<{ name: string; last_tick_at: number }>
    for (const r of rows) {
      const name = String(r.name) as SystemLoopName
      if (name in out) out[name] = Number(r.last_tick_at || 0)
    }
  } catch {
    // ignore
  }

  return out
}
