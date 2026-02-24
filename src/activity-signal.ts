// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Activity Signal — canonical "last real activity" for enforcement decisions.
 *
 * Problem: task.updatedAt is brittle — it's bumped by metadata edits, reviewer
 * assignment, and other non-activity changes. Enforcement keying off updatedAt
 * produces false stale warnings.
 *
 * Solution: effective_activity_ts = max(
 *   last_status_comment_at,   — most recent task comment by assigned agent
 *   last_state_transition_at, — most recent status change in task_history
 *   task_created_at,          — fallback for brand-new tasks
 * )
 *
 * Each signal source is tracked so warnings can report WHY enforcement fired.
 */

import { getDb } from './db.js'

// ── Types ──

export type ActivitySource =
  | 'status_comment'      // Agent posted a task comment
  | 'state_transition'    // Task status changed (doing → validating, etc.)
  | 'task_created'        // Fallback: task was just created
  | 'none'                // No signal found

export interface ActivitySignal {
  /** The effective timestamp used for enforcement decisions */
  effectiveActivityTs: number
  /** Which source produced the winning timestamp */
  source: ActivitySource
  /** Individual signal timestamps for debugging */
  signals: {
    lastCommentAt: number | null
    lastStateTransitionAt: number | null
    taskCreatedAt: number
  }
}

// ── Core function ──

/**
 * Compute the effective activity signal for a task.
 *
 * @param taskId - Task ID
 * @param agent - Optional: restrict comment lookups to this agent
 * @param taskCreatedAt - Fallback timestamp (from task record)
 * @returns ActivitySignal with effective timestamp and source
 */
export function getEffectiveActivity(
  taskId: string,
  agent?: string | null,
  taskCreatedAt?: number,
): ActivitySignal {
  const db = getDb()
  const now = Date.now()
  const created = taskCreatedAt || now

  // 1. Last comment by the agent (or any author)
  let lastCommentAt: number | null = null
  try {
    const commentQuery = agent
      ? db.prepare(
          'SELECT MAX(timestamp) as latest FROM task_comments WHERE task_id = ? AND author = ?'
        ).get(taskId, agent) as { latest: number | null } | undefined
      : db.prepare(
          'SELECT MAX(timestamp) as latest FROM task_comments WHERE task_id = ?'
        ).get(taskId) as { latest: number | null } | undefined
    lastCommentAt = commentQuery?.latest ?? null
  } catch {
    // DB not available — fall through
  }

  // 2. Last state transition from task_history
  let lastStateTransitionAt: number | null = null
  try {
    const historyRow = db.prepare(
      'SELECT MAX(timestamp) as latest FROM task_history WHERE task_id = ?'
    ).get(taskId) as { latest: number | null } | undefined
    lastStateTransitionAt = historyRow?.latest ?? null
  } catch {
    // DB not available — fall through
  }

  // 3. Determine winner (monotonic: highest timestamp wins)
  const candidates: Array<{ ts: number; source: ActivitySource }> = []

  if (lastCommentAt !== null && lastCommentAt > 0) {
    candidates.push({ ts: lastCommentAt, source: 'status_comment' })
  }
  if (lastStateTransitionAt !== null && lastStateTransitionAt > 0) {
    candidates.push({ ts: lastStateTransitionAt, source: 'state_transition' })
  }
  candidates.push({ ts: created, source: 'task_created' })

  // Sort descending — highest timestamp wins (monotonic guard)
  candidates.sort((a, b) => b.ts - a.ts)
  const winner = candidates[0]

  return {
    effectiveActivityTs: winner.ts,
    source: winner.source,
    signals: {
      lastCommentAt,
      lastStateTransitionAt,
      taskCreatedAt: created,
    },
  }
}

/**
 * Format an activity signal for inclusion in warning messages.
 *
 * Example output:
 *   "last activity: 47m ago (status_comment at 2025-01-15 14:23 UTC), threshold: 90m"
 */
export function formatActivityWarning(
  signal: ActivitySignal,
  thresholdMin: number,
  now?: number,
): string {
  const ts = now || Date.now()
  const ageMin = Math.floor((ts - signal.effectiveActivityTs) / 60_000)
  const sourceLabel = signal.source.replace(/_/g, ' ')
  const timeStr = new Date(signal.effectiveActivityTs).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

  return `last activity: ${ageMin}m ago (${sourceLabel} at ${timeStr}), threshold: ${thresholdMin}m`
}
