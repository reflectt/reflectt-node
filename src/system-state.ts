// SPDX-License-Identifier: Apache-2.0
// Minimal persistent runtime state (timestamps, last-seen markers)

import { getDb } from './db.js'

export type SystemStateRow = {
  key: string
  value_int: number | null
  value_text: string | null
  updated_at: number
}

export function setSystemStateInt(key: string, value: number, updatedAt: number = Date.now()): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO system_state (key, value_int, value_text, updated_at)
     VALUES (?, ?, NULL, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_int = excluded.value_int,
       value_text = NULL,
       updated_at = excluded.updated_at`,
  ).run(key, value, updatedAt)
}

export function getSystemStateRows(keys: string[]): SystemStateRow[] {
  if (keys.length === 0) return []
  const db = getDb()
  const placeholders = keys.map(() => '?').join(',')
  return db.prepare(
    `SELECT key, value_int, value_text, updated_at
     FROM system_state
     WHERE key IN (${placeholders})`,
  ).all(...keys) as SystemStateRow[]
}

export function getSystemStateSnapshot(keys: string[]): Record<string, number | string | null> {
  const rows = getSystemStateRows(keys)
  const out: Record<string, number | string | null> = {}
  for (const k of keys) out[k] = null
  for (const r of rows) {
    out[r.key] = (r.value_int ?? r.value_text ?? null)
  }
  return out
}
