// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Notification Dedupe Guard
 *
 * Prevents stale/out-of-order task notification events:
 *   1. Tracks lastSeen {updatedAt, status } per taskId — drops stale events and same-rank re-emits
 *   2. Checks current task status before emitting — suppresses contradictory transitions
 *      (e.g., event says →doing but task is already done/cancelled)
 *   3. Uses strict > (not >=) cursor semantics for poller ordering
 */

// ── In-memory cursor: taskId → { updatedAt, status } ───────────────────────

interface CursorEntry {
  updatedAt: number
  status: string
}

const lastSeenByTaskId = new Map<string, CursorEntry>()

// ── Status ordering (higher = further along the lifecycle) ─────────────────

const STATUS_ORDER: Record<string, number> = {
  todo: 0,
  doing: 1,
  blocked: 1, // lateral to doing
  validating: 2,
  done: 3,
  cancelled: 3,
  resolved_externally: 3,
}

function statusRank(s: string): number {
  return STATUS_ORDER[s] ?? -1
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface DedupeCheckInput {
  taskId: string
  eventUpdatedAt: number       // updatedAt from the event payload
  eventStatus: string          // status the event is announcing (e.g., 'doing')
  currentTaskStatus?: string   // live task status from DB (if available)
  currentTaskUpdatedAt?: number // live task updatedAt from DB (if available)
  /** Target agent receiving this notification. Scopes the cursor per-agent so
   *  two recipients of the same event (e.g. assignee + reviewer on 'done')
   *  are not mutually suppressed by each other's cursor update. */
  targetAgent?: string
}

export interface DedupeCheckResult {
  emit: boolean
  reason?: string
}

// ── Core Logic ─────────────────────────────────────────────────────────────

/**
 * Check whether a task notification should be emitted.
 * Returns { emit: true } if it should proceed, or { emit: false, reason } if suppressed.
 */
export function shouldEmitNotification(input: DedupeCheckInput): DedupeCheckResult {
  const { taskId, eventUpdatedAt, eventStatus, currentTaskStatus, currentTaskUpdatedAt, targetAgent } = input

  // Cursor key is scoped per (taskId, targetAgent) so two different recipients of the
  // same event (e.g. assignee + reviewer both getting taskCompleted on 'done') are not
  // mutually suppressed by each other's cursor update.
  const cursorKey = targetAgent ? `${taskId}:${targetAgent}` : taskId

  // Guard 1: Monotonic cursor — drop events with updatedAt < lastSeen
  // Also detect same-rank re-emit: same updatedAt AND same status as last emission.
  // Guard 2 handles contradictory transitions (currentRank > eventRank).
  const lastSeen = lastSeenByTaskId.get(cursorKey)
  if (lastSeen !== undefined) {
    if (eventUpdatedAt < lastSeen.updatedAt) {
      return {
        emit: false,
        reason: `Stale event: updatedAt ${eventUpdatedAt} < lastSeen ${lastSeen.updatedAt} for ${cursorKey}`,
      }
    }
    if (eventUpdatedAt === lastSeen.updatedAt && eventStatus === lastSeen.status) {
      return {
        emit: false,
        reason: `Same-rank re-emit: →${eventStatus} already emitted at ${eventUpdatedAt} for ${cursorKey}`,
      }
    }
  }

  // Guard 2: Contradictory transition — event status is behind current task status
  if (currentTaskStatus && currentTaskUpdatedAt !== undefined) {
    const eventRank = statusRank(eventStatus)
    const currentRank = statusRank(currentTaskStatus)

    // If current task is further along than the event claims, suppress.
    // Guard 1 (monotonic cursor) handles ordering via updatedAt.
    // Guard 2 catches contradictory transitions: event says →doing but task is already done.
    if (currentRank > eventRank) {
      return {
        emit: false,
        reason: `Contradictory: event says →${eventStatus} but task is already ${currentTaskStatus}`,
      }
    }
  }

  // Update cursor
  lastSeenByTaskId.set(cursorKey, { updatedAt: eventUpdatedAt, status: eventStatus })

  return { emit: true }
}

/**
 * Get current dedup state for diagnostics.
 */
export function getDedupeState(): { cursors: Record<string, CursorEntry>; size: number } {
  const cursors: Record<string, CursorEntry> = {}
  for (const [k, v] of lastSeenByTaskId) cursors[k] = v
  return { cursors, size: lastSeenByTaskId.size }
}

/**
 * Clear all cursors (for testing).
 */
export function clearDedupeState(): void {
  lastSeenByTaskId.clear()
}

/**
 * Prune old cursors to prevent unbounded memory growth.
 * Removes entries older than maxAgeMs.
 */
export function pruneDedupeState(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs
  let pruned = 0
  for (const [taskId, entry] of lastSeenByTaskId) {
    if (entry.updatedAt < cutoff) {
      lastSeenByTaskId.delete(taskId)
      pruned++
    }
  }
  return pruned
}
