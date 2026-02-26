// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Message Router
 *
 * Routes system messages to the appropriate channel based on severity
 * and message type. Keeps #general clean for decisions, blockers,
 * and ship notices only.
 *
 * Routing rules:
 * - critical/escalation → #general (human attention required)
 * - routine watchdog/status → #ops
 * - task-scoped updates → task comments (when task ID available)
 * - ship notices → #shipping
 * - review requests → #reviews
 * - blocker alerts → #blockers
 *
 * All routing decisions are logged for observability.
 */

import { chatManager } from './chat.js'
import { taskManager } from './tasks.js'
import { policyManager } from './policy.js'
import { noiseBudgetManager } from './noise-budget.js'
import { alertIntegrityGuard, type AlertPreflightInput } from './alert-integrity.js'

// ── Types ──────────────────────────────────────────────────────────────────

export type MessageSeverity = 'critical' | 'warning' | 'info' | 'debug'

export type MessageCategory =
  | 'escalation'       // Human attention required NOW
  | 'blocker'          // Active blocker reported
  | 'ship-notice'      // Artifact shipped
  | 'review-request'   // Review needed
  | 'watchdog-alert'   // Watchdog enforcement (idle nudge, cadence, etc.)
  | 'status-update'    // Routine status update
  | 'digest'           // Periodic digest
  | 'system-info'      // System-level informational
  | 'mention-rescue'   // Fallback nudge for unresponded mentions
  | 'continuity-loop'  // Queue replenishment and self-nudge automation

export interface RoutedMessage {
  from: string
  content: string
  /** Explicit severity override */
  severity?: MessageSeverity
  /** Message category for routing */
  category?: MessageCategory
  /** Related task ID — if present, may route to task comment instead */
  taskId?: string | null
  /** Force a specific channel (bypass routing) */
  forceChannel?: string
  /** Mentioned agents (used for escalation detection) */
  mentions?: string[]
}

export interface RoutingDecision {
  channel: string
  alsoComment: boolean
  reason: string
}

export interface RoutingResult {
  decision: RoutingDecision
  messageId: string | null
  commentId: string | null
}

// ── Router ─────────────────────────────────────────────────────────────────

const routingLog: Array<{
  timestamp: number
  category: string
  severity: string
  channel: string
  reason: string
  taskId: string | null
}> = []
const MAX_ROUTING_LOG = 500

/**
 * Route a system message to the appropriate channel + optionally add task comment.
 * Applies noise budget checks before sending (duplicate suppression, digest batching, per-channel budget).
 */
export async function routeMessage(msg: RoutedMessage): Promise<RoutingResult> {
  const decision = resolveRoute(msg)

  let messageId: string | null = null
  let commentId: string | null = null

  // ── Alert Integrity Preflight ────────────────────────────────────────
  // For task-scoped alerts, reconcile live state before sending
  if (msg.taskId && msg.category) {
    const alertTypeMap: Record<string, AlertPreflightInput['alertType']> = {
      'watchdog-alert': 'watchdog',
      'escalation': 'escalation',
      'mention-rescue': 'mention_rescue',
      'status-update': 'generic',
      'continuity-loop': 'idle_nudge',
    }
    const alertType = alertTypeMap[msg.category] || 'generic'

    const preflightResult = alertIntegrityGuard.preflight({
      taskId: msg.taskId,
      alertType,
      content: msg.content,
      from: msg.from,
    })

    if (!preflightResult.allowed) {
      routingLog.push({
        timestamp: Date.now(),
        category: msg.category || 'unknown',
        severity: msg.severity || 'info',
        channel: decision.channel,
        reason: `alert_integrity_suppressed:${preflightResult.reasonCode}`,
        taskId: msg.taskId || null,
      })
      if (routingLog.length > MAX_ROUTING_LOG) {
        routingLog.splice(0, routingLog.length - MAX_ROUTING_LOG)
      }
      return { decision, messageId: null, commentId: null }
    }
  }

  // ── Noise Budget Pre-send Check ──────────────────────────────────────
  const budgetCheck = noiseBudgetManager.checkMessage({
    from: msg.from,
    content: msg.content,
    channel: decision.channel,
    category: msg.category,
    severity: msg.severity,
    taskId: msg.taskId,
  })

  if (!budgetCheck.allowed) {
    // Message suppressed or queued for digest — log but don't send
    routingLog.push({
      timestamp: Date.now(),
      category: msg.category || 'unknown',
      severity: msg.severity || 'info',
      channel: decision.channel,
      reason: `suppressed:${budgetCheck.reason}`,
      taskId: msg.taskId || null,
    })
    if (routingLog.length > MAX_ROUTING_LOG) {
      routingLog.splice(0, routingLog.length - MAX_ROUTING_LOG)
    }

    // Still add task comment even if chat message was suppressed
    if (decision.alsoComment && msg.taskId) {
      try {
        const comment = await taskManager.addTaskComment(
          msg.taskId,
          msg.from,
          msg.content,
        )
        commentId = comment?.id || null
      } catch {
        // Non-fatal
      }
    }

    return { decision, messageId: null, commentId }
  }
  // ── End Noise Budget Check ───────────────────────────────────────────

  // If routing to task comment, try comment FIRST to verify task exists.
  // Only emit [task-comment:...] chat line if comment was actually created.
  let taskCommentFailed = false
  if (decision.alsoComment && msg.taskId) {
    try {
      const comment = await taskManager.addTaskComment(
        msg.taskId,
        msg.from,
        msg.content,
      )
      commentId = comment?.id || null
    } catch {
      // Task doesn't exist or comment failed — don't emit phantom chat line
      taskCommentFailed = true
    }
  }

  // Send to resolved channel (skip if this was purely a task-comment route and comment failed)
  const skipChat = taskCommentFailed && decision.reason === 'status-update-to-task-comment'
  if (!skipChat) {
    try {
      const sent = await chatManager.sendMessage({
        from: msg.from,
        channel: decision.channel,
        content: msg.content,
      })
      messageId = sent?.id || null
    } catch {
      // Non-fatal
    }
  }

  // Log routing decision
  routingLog.push({
    timestamp: Date.now(),
    category: msg.category || 'unknown',
    severity: msg.severity || 'info',
    channel: decision.channel,
    reason: decision.reason,
    taskId: msg.taskId || null,
  })
  if (routingLog.length > MAX_ROUTING_LOG) {
    routingLog.splice(0, routingLog.length - MAX_ROUTING_LOG)
  }

  return { decision, messageId, commentId }
}

/**
 * Resolve routing without sending — for dry-run/preview.
 */
export function resolveRoute(msg: RoutedMessage): RoutingDecision {
  // Explicit channel override
  if (msg.forceChannel) {
    return { channel: msg.forceChannel, alsoComment: false, reason: 'force-channel' }
  }

  const category = msg.category || classifyMessage(msg)
  const severity = msg.severity || 'info'
  const policy = policyManager.get()

  // Critical severity always goes to #general
  if (severity === 'critical') {
    return {
      channel: policy.escalation.criticalChannel,
      alsoComment: Boolean(msg.taskId),
      reason: 'critical-severity',
    }
  }

  switch (category) {
    case 'escalation':
      return {
        channel: policy.escalation.criticalChannel,
        alsoComment: Boolean(msg.taskId),
        reason: 'escalation-to-general',
      }

    case 'blocker':
      return {
        channel: 'blockers',
        alsoComment: Boolean(msg.taskId),
        reason: 'blocker-to-blockers-channel',
      }

    case 'ship-notice':
      return {
        channel: 'shipping',
        alsoComment: Boolean(msg.taskId),
        reason: 'ship-to-shipping-channel',
      }

    case 'review-request':
      return {
        channel: 'reviews',
        alsoComment: Boolean(msg.taskId),
        reason: 'review-to-reviews-channel',
      }

    case 'watchdog-alert':
      // Watchdog alerts go to ops — unless they're escalations (tier 2)
      if (severity === 'warning' && msg.mentions?.length) {
        return {
          channel: policy.escalation.defaultChannel,
          alsoComment: Boolean(msg.taskId),
          reason: 'watchdog-escalation-to-general',
        }
      }
      return {
        channel: 'ops',
        alsoComment: Boolean(msg.taskId),
        reason: 'watchdog-to-ops',
      }

    case 'status-update':
      // Routine status updates → task comment if possible, else ops
      if (msg.taskId) {
        return {
          channel: 'ops',
          alsoComment: true,
          reason: 'status-update-to-task-comment',
        }
      }
      return {
        channel: 'ops',
        alsoComment: false,
        reason: 'status-update-to-ops',
      }

    case 'digest':
      return {
        channel: policy.escalation.digestChannel,
        alsoComment: false,
        reason: 'digest-to-configured-channel',
      }

    case 'mention-rescue':
      // Mention rescue stays in general — it's a user-facing nudge
      return {
        channel: policy.escalation.defaultChannel,
        alsoComment: false,
        reason: 'mention-rescue-to-general',
      }

    case 'system-info':
    default:
      return {
        channel: 'ops',
        alsoComment: false,
        reason: 'system-info-to-ops',
      }
  }
}

/**
 * Auto-classify message content when no explicit category given.
 */
function classifyMessage(msg: RoutedMessage): MessageCategory {
  const content = msg.content.toLowerCase()

  if (/\bescalat/i.test(content)) return 'escalation'
  if (/\bblocker\b/i.test(content) && !/blocker:\s*none/i.test(content)) return 'blocker'
  if (/\bshipped\b|\bmerged\b|\bartifact\b/i.test(content)) return 'ship-notice'
  if (/\breview\s*(request|needed|required)/i.test(content)) return 'review-request'
  if (/system\s*(watchdog|reminder|fallback|nudge)/i.test(content)) return 'watchdog-alert'
  if (/\bdigest\b/i.test(content)) return 'digest'
  if (/\bstatus\b.*\bupdate\b/i.test(content)) return 'status-update'

  return 'system-info'
}

// ── Query ──────────────────────────────────────────────────────────────────

export function getRoutingLog(options?: {
  limit?: number
  since?: number
  category?: MessageCategory
  severity?: MessageSeverity
}): typeof routingLog {
  let log = routingLog

  if (options?.since) {
    log = log.filter(e => e.timestamp >= options.since!)
  }
  if (options?.category) {
    log = log.filter(e => e.category === options.category)
  }
  if (options?.severity) {
    log = log.filter(e => e.severity === options.severity)
  }

  // Most recent first
  log = log.slice().sort((a, b) => b.timestamp - a.timestamp)

  if (options?.limit) {
    log = log.slice(0, options.limit)
  }

  return log
}

export function getRoutingStats(): {
  totalRouted: number
  byChannel: Record<string, number>
  byCategory: Record<string, number>
  bySeverity: Record<string, number>
  generalCount: number
  opsCount: number
  taskCommentCount: number
} {
  const byChannel: Record<string, number> = {}
  const byCategory: Record<string, number> = {}
  const bySeverity: Record<string, number> = {}
  let taskCommentCount = 0

  for (const entry of routingLog) {
    byChannel[entry.channel] = (byChannel[entry.channel] || 0) + 1
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1
    bySeverity[entry.severity] = (bySeverity[entry.severity] || 0) + 1
    if (entry.taskId) taskCommentCount++
  }

  return {
    totalRouted: routingLog.length,
    byChannel,
    byCategory,
    bySeverity,
    generalCount: byChannel['general'] || 0,
    opsCount: byChannel['ops'] || 0,
    taskCommentCount,
  }
}
