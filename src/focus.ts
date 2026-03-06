// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Team Focus — Priority Anchor
 *
 * Prevents context/priority drift between agent sessions.
 * The team lead (or any agent) sets the current focus directive,
 * and it's surfaced in every heartbeat response so agents wake up
 * knowing what matters RIGHT NOW.
 *
 * Addresses insight ins-1771941663932-11l8qifnl:
 * "Context and priorities drift between pushes"
 */

import { getDb } from './db.js'

export interface TeamFocus {
  directive: string          // e.g. "Features over fixes. Activity timeline is P0."
  setBy: string              // agent or human who set it
  setAt: number              // timestamp
  expiresAt?: number | null  // optional auto-expire (e.g. end of day)
  tags?: string[]            // optional categorization
}

const DB_KEY = 'team_focus'

function db() {
  return getDb()
}

export function getFocus(): TeamFocus | null {
  const row = db().prepare('SELECT value FROM kv WHERE key = ?').get(DB_KEY) as { value: string } | undefined
  if (!row) return null

  try {
    const focus = JSON.parse(row.value) as TeamFocus
    // Check expiry
    if (focus.expiresAt && Date.now() > focus.expiresAt) {
      clearFocus()
      return null
    }
    return focus
  } catch {
    return null
  }
}

export function setFocus(directive: string, setBy: string, opts?: { expiresAt?: number; tags?: string[] }): TeamFocus {
  const focus: TeamFocus = {
    directive: directive.trim(),
    setBy,
    setAt: Date.now(),
    expiresAt: opts?.expiresAt ?? null,
    tags: opts?.tags,
  }

  db().prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(DB_KEY, JSON.stringify(focus))
  return focus
}

export function clearFocus(): void {
  db().prepare('DELETE FROM kv WHERE key = ?').run(DB_KEY)
}

/** Compact summary for heartbeat inclusion (minimal tokens) */
export function getFocusSummary(): { focus: string; setBy: string; setAt: number } | null {
  const f = getFocus()
  if (!f) return null
  return { focus: f.directive, setBy: f.setBy, setAt: f.setAt }
}
