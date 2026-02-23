// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Shipped-Artifact Auto-Heartbeat
 *
 * Emits a compact status update to #general when a task transitions to
 * validating or done AND has an artifact_path in metadata.
 *
 * Payload format (sage-validated contract):
 *   [SHIP] <task_id> | shipped:<ref> | next:<eta> | review:@<reviewer> | by:@<owner>
 *
 * Suppression rules:
 *   1. Dedup window (30m) — same task won't re-fire within 30 minutes
 *   2. Reviewer override — if reviewer posts in #general within 5m of the
 *      trigger, the auto-heartbeat is suppressed (they wrote their own)
 *   3. Missing/invalid artifact — silently skipped with warning log
 *
 * Failure modes (documented per done criteria):
 *   - Duplicate spam: dedup map with 30m TTL prevents double-posts on rapid
 *     status flips (e.g., validating→blocked→validating)
 *   - Missing artifact link: task without metadata.artifact_path is skipped;
 *     logged at warn level for ops visibility
 *   - Reviewer already posted: 5m look-back in #general for reviewer messages
 *     mentioning the task ID suppresses the auto-heartbeat
 *   - Chat budget exceeded: respects existing noise-budget in chat.sendMessage;
 *     if budget blocks the message, it's logged but not retried
 *
 * Task: task-1771691652369-2c2y0uknl
 * Design: scout (pilot spec) → Implementation: link
 */

import { eventBus, type Event } from './events.js'
import { chatManager } from './chat.js'
import type { Task } from './types.js'

// ── Config ──

const LISTENER_ID = 'shipped-heartbeat'

/** Dedup window in ms (30 minutes) */
const DEDUP_WINDOW_MS = 30 * 60 * 1000

/** Look-back window for reviewer override check (5 minutes) */
const REVIEWER_OVERRIDE_WINDOW_MS = 5 * 60 * 1000

/** Target channel for heartbeat posts */
const TARGET_CHANNEL = 'general'

/** Statuses that trigger the heartbeat */
const TRIGGER_STATUSES = new Set(['validating', 'done'])

// ── State ──

/** Map of taskId → last emit timestamp for dedup */
const dedupMap = new Map<string, number>()

/** Cleanup interval handle */
let cleanupInterval: NodeJS.Timeout | null = null

// ── Types ──

export interface ShippedHeartbeatPayload {
  taskId: string
  shipped: string        // artifact_path or PR ref
  next: string           // ETA or 'done'
  reviewer: string       // @reviewer or 'none'
  owner: string          // @assignee
  lane: 'ops' | 'product' | 'comms' | 'engineering' | 'unknown'
}

export interface HeartbeatStats {
  totalEmitted: number
  totalSuppressed: number
  suppressionReasons: Record<string, number>
  lastEmittedAt: number | null
}

// ── Telemetry ──

const stats: HeartbeatStats = {
  totalEmitted: 0,
  totalSuppressed: 0,
  suppressionReasons: {},
  lastEmittedAt: null,
}

function recordSuppression(reason: string): void {
  stats.totalSuppressed++
  stats.suppressionReasons[reason] = (stats.suppressionReasons[reason] || 0) + 1
}

// ── Core Logic ──

/**
 * Build a compact heartbeat payload from a task.
 */
export function buildPayload(task: Task): ShippedHeartbeatPayload | null {
  const artifactPath = (task.metadata as any)?.artifact_path
  if (!artifactPath || typeof artifactPath !== 'string') {
    return null
  }

  const lane = inferLane(task)
  const eta = task.status === 'done'
    ? 'done'
    : (task.metadata as any)?.eta ?? 'pending review'

  return {
    taskId: task.id,
    shipped: artifactPath,
    next: eta,
    reviewer: task.reviewer ? `@${task.reviewer}` : 'none',
    owner: task.assignee ? `@${task.assignee}` : 'unknown',
    lane,
  }
}

/**
 * Format the canonical compact message.
 *
 * Examples:
 *   [SHIP] task-abc123 | shipped:process/spec.md | next:pending review | review:@sage | by:@scout
 *   [SHIP] task-def456 | shipped:src/feature.ts | next:done | review:@kai | by:@link
 *   [SHIP] task-ghi789 | shipped:docs/runbook.md | next:~2h | review:@pixel | by:@echo
 */
export function formatMessage(payload: ShippedHeartbeatPayload): string {
  return `[SHIP] ${payload.taskId} | shipped:${payload.shipped} | next:${payload.next} | review:${payload.reviewer} | by:${payload.owner}`
}

/**
 * Infer the task lane from metadata, tags, or title keywords.
 */
function inferLane(task: Task): ShippedHeartbeatPayload['lane'] {
  const meta = task.metadata as Record<string, unknown> | undefined
  const roleType = (meta?.role_type as string) ?? ''
  const tags = task.tags ?? []
  const title = (task.title ?? '').toLowerCase()

  if (roleType.includes('ops') || tags.includes('ops')) return 'ops'
  if (roleType.includes('product') || tags.includes('product')) return 'product'
  if (roleType.includes('comms') || tags.includes('comms')) return 'comms'
  if (tags.includes('engineering') || tags.includes('dev')) return 'engineering'

  // Fallback heuristics from title
  if (title.includes('deploy') || title.includes('infra') || title.includes('ci')) return 'ops'
  if (title.includes('design') || title.includes('spec') || title.includes('feature')) return 'product'
  if (title.includes('announce') || title.includes('blog') || title.includes('docs')) return 'comms'

  return 'unknown'
}

// ── Suppression Checks ──

/**
 * Check dedup window — returns true if this task was already emitted recently.
 */
function isDuplicate(taskId: string): boolean {
  const lastEmit = dedupMap.get(taskId)
  if (!lastEmit) return false
  return (Date.now() - lastEmit) < DEDUP_WINDOW_MS
}

/**
 * Check if reviewer already posted about this task in #general recently.
 * Returns true if reviewer override should suppress the auto-heartbeat.
 */
function isReviewerOverride(task: Task): boolean {
  if (!task.reviewer) return false

  const cutoff = Date.now() - REVIEWER_OVERRIDE_WINDOW_MS
  const recentMessages = chatManager.getMessages({
    channel: TARGET_CHANNEL,
    since: cutoff,
    limit: 20,
  })

  return recentMessages.some(msg =>
    msg.from === task.reviewer &&
    msg.content.includes(task.id)
  )
}

/**
 * Validate artifact_path is under process/ (canonical location).
 */
function isValidArtifactPath(artifactPath: string): boolean {
  // Accept process/ paths and src/ paths (code artifacts)
  return artifactPath.startsWith('process/') ||
         artifactPath.startsWith('src/') ||
         artifactPath.startsWith('docs/')
}

// ── Event Handler ──

async function handleTaskEvent(event: Event): Promise<void> {
  if (event.type !== 'task_updated') return

  const task = event.data as Task
  if (!task?.status || !task?.id) return

  // Only trigger on validating/done transitions
  if (!TRIGGER_STATUSES.has(task.status)) return

  const artifactPath = (task.metadata as any)?.artifact_path
  if (!artifactPath || typeof artifactPath !== 'string') {
    console.warn(`[ShippedHeartbeat] Task ${task.id} → ${task.status} but no artifact_path — skipping`)
    recordSuppression('missing_artifact')
    return
  }

  if (!isValidArtifactPath(artifactPath)) {
    console.warn(`[ShippedHeartbeat] Task ${task.id} has non-canonical artifact_path: ${artifactPath} — skipping`)
    recordSuppression('invalid_artifact_path')
    return
  }

  // Suppression: dedup window
  if (isDuplicate(task.id)) {
    console.log(`[ShippedHeartbeat] Task ${task.id} suppressed (dedup 30m window)`)
    recordSuppression('dedup_window')
    return
  }

  // Suppression: reviewer override
  if (isReviewerOverride(task)) {
    console.log(`[ShippedHeartbeat] Task ${task.id} suppressed (reviewer @${task.reviewer} already posted)`)
    recordSuppression('reviewer_override')
    return
  }

  // Build and send
  const payload = buildPayload(task)
  if (!payload) {
    recordSuppression('payload_build_failed')
    return
  }

  const message = formatMessage(payload)

  try {
    await chatManager.sendMessage({
      from: 'system',
      channel: TARGET_CHANNEL,
      content: message,
      metadata: {
        type: 'shipped_heartbeat',
        taskId: task.id,
        lane: payload.lane,
        artifactPath: payload.shipped,
      },
    })

    // Record success
    dedupMap.set(task.id, Date.now())
    stats.totalEmitted++
    stats.lastEmittedAt = Date.now()

    console.log(`[ShippedHeartbeat] Emitted for ${task.id}: ${message}`)
  } catch (err) {
    console.error(`[ShippedHeartbeat] Failed to send for ${task.id}:`, err)
  }
}

// ── Dedup Cleanup ──

function cleanupDedupMap(): void {
  const cutoff = Date.now() - DEDUP_WINDOW_MS
  for (const [taskId, timestamp] of dedupMap) {
    if (timestamp < cutoff) {
      dedupMap.delete(taskId)
    }
  }
}

// ── Lifecycle ──

export function startShippedHeartbeat(): void {
  eventBus.on(LISTENER_ID, handleTaskEvent)
  cleanupInterval = setInterval(cleanupDedupMap, DEDUP_WINDOW_MS)
  console.log('[ShippedHeartbeat] Listening for shipped-artifact events')
}

export function stopShippedHeartbeat(): void {
  eventBus.off(LISTENER_ID)
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
  }
  dedupMap.clear()
  console.log('[ShippedHeartbeat] Stopped')
}

export function getShippedHeartbeatStats(): HeartbeatStats {
  return { ...stats }
}

// ── Exports for Testing ──

export const _testing = {
  handleTaskEvent,
  isDuplicate,
  isReviewerOverride,
  isValidArtifactPath,
  inferLane,
  dedupMap,
  stats,
  DEDUP_WINDOW_MS,
  REVIEWER_OVERRIDE_WINDOW_MS,
}
