// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Notification Dedupe Guard
 *
 * Prevents stale/out-of-order task notification events:
 *   1. Tracks lastSeenUpdatedAt per taskId — drops events with updatedAt <= lastSeen
 *   2. Checks current task status before emitting — suppresses contradictory transitions
 *      (e.g., event says →doing but task is already done/cancelled)
 *   3. Uses strict > (not >=) cursor semantics for poller ordering
 */

// ── In-memory cursor: taskId → last seen updatedAt ─────────────────────────

const lastSeenByTaskId = new Map<string, number>()

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
  const { taskId, eventUpdatedAt, eventStatus, currentTaskStatus, currentTaskUpdatedAt } = input

  // Guard 1: Monotonic cursor — drop events with updatedAt <= lastSeen
  const lastSeen = lastSeenByTaskId.get(taskId)
  if (lastSeen !== undefined && eventUpdatedAt <= lastSeen) {
    return {
      emit: false,
      reason: `Stale event: updatedAt ${eventUpdatedAt} <= lastSeen ${lastSeen} for ${taskId}`,
    }
  }

  // Guard 2: Contradictory transition — event status is behind current task status
  if (currentTaskStatus && currentTaskUpdatedAt !== undefined) {
    const eventRank = statusRank(eventStatus)
    const currentRank = statusRank(currentTaskStatus)

    // If current task is further along AND has a newer updatedAt, suppress
    if (currentRank > eventRank && currentTaskUpdatedAt > eventUpdatedAt) {
      return {
        emit: false,
        reason: `Contradictory: event says →${eventStatus} but task is already ${currentTaskStatus} (updatedAt: ${currentTaskUpdatedAt} > ${eventUpdatedAt})`,
      }
    }
  }

  // Update cursor
  lastSeenByTaskId.set(taskId, eventUpdatedAt)

  return { emit: true }
}

/**
 * Get current dedup state for diagnostics.
 */
export function getDedupeState(): { cursors: Record<string, number>; size: number } {
  const cursors: Record<string, number> = {}
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
  for (const [taskId, ts] of lastSeenByTaskId) {
    if (ts < cutoff) {
      lastSeenByTaskId.delete(taskId)
      pruned++
    }
  }
  return pruned
}
