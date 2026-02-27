/**
 * Chat Approval Detector
 *
 * Bridges chat-based reviewer approvals to formal task review decisions.
 *
 * Problem: When a reviewer says "LGTM" or "approved" in chat, the task stays
 * stuck in "validating" because chat messages don't trigger the formal review
 * endpoint (POST /tasks/:id/review). This module detects approval signals in
 * chat messages and auto-submits the formal review decision.
 *
 * Resolution logic:
 *   1. If the message explicitly references a task ID → target that task
 *   2. If the reviewer has exactly one task in "validating" → target that
 *   3. If ambiguous (multiple validating tasks, no reference) → skip + log
 *
 * Safety:
 *   - Only triggers for the assigned reviewer (reviewer identity gate)
 *   - Only fires once per task (idempotent — checks reviewer_approved first)
 *   - Adds audit comment documenting the auto-detection
 *   - Never auto-rejects (approval signals only)
 */

import { taskManager } from './tasks.js'
import type { Task } from './types.js'

// ── Approval signal patterns ──

const APPROVAL_PATTERNS: RegExp[] = [
  /\blgtm\b/i,
  /\bapproved?\b/i,
  /\bship\s*it\b/i,
  /\blooks\s+good\s+to\s+me\b/i,
  /\blooks\s+great\b/i,
  /\b(?:good\s+to\s+(?:go|merge|ship))\b/i,
  /\b(?:all\s+good|looks\s+solid|nice\s+work|well\s+done)\b/i,
  /\b(?:✅|👍)\s*(?:approved?|lgtm|merge|ship)?\b/i,
  /(?:✅|👍)\s*$/,  // standalone emoji at end of message
  /^\s*(?:✅|👍)\s*$/,  // standalone emoji as entire message
]

// Negative patterns — if these match, don't treat as approval
const REJECTION_PATTERNS: RegExp[] = [
  /\bnot\s+(?:approved?|lgtm|ready)\b/i,
  /\bdon'?t\s+(?:approve|ship|merge)\b/i,
  /\bneeds?\s+(?:work|changes?|fixes?|rework)\b/i,
  /\breject(?:ed|ing)?\b/i,
  /\bblock(?:ed|ing|er)?\b/i,
  /\bnit(?:s|pick)?\b/i,   // nit alone is not rejection but…
  /\bfix\s+before\s+merge\b/i,
  /\brequested?\s+changes?\b/i,
]

// ── Task ID extraction ──

const TASK_ID_PATTERN = /\b(task-\d{13,}-[a-z0-9]+)\b/gi

function extractTaskIds(content: string): string[] {
  const matches = content.match(TASK_ID_PATTERN)
  return matches ? [...new Set(matches.map(m => m.toLowerCase()))] : []
}

// ── Core detection ──

export interface ApprovalSignal {
  taskId: string
  reviewer: string
  source: 'explicit_reference' | 'sole_validating'
  matchedPattern: string
  comment: string
}

export interface DetectionResult {
  detected: boolean
  signal?: ApprovalSignal
  skipped?: {
    reason: 'no_approval_signal' | 'rejection_signal' | 'not_a_reviewer' |
            'already_approved' | 'ambiguous_tasks' | 'no_validating_tasks' |
            'task_not_validating' | 'reviewer_mismatch'
    details?: string
  }
}

/**
 * Check if a chat message contains an approval signal from a reviewer.
 */
export function detectApproval(
  from: string,
  content: string,
): DetectionResult {
  // Step 1: Check for approval signal in content
  const approvalMatch = APPROVAL_PATTERNS.find(p => p.test(content))
  if (!approvalMatch) {
    return { detected: false, skipped: { reason: 'no_approval_signal' } }
  }

  // Step 2: Check for rejection/negation signals (override approval)
  const hasRejection = REJECTION_PATTERNS.some(p => p.test(content))
  if (hasRejection) {
    return { detected: false, skipped: { reason: 'rejection_signal' } }
  }

  const matchedPattern = approvalMatch.source

  // Step 3: Find tasks where `from` is the assigned reviewer + status is validating
  const validatingTasks = taskManager.listTasks({ status: 'validating' })
    .filter(t =>
      t.reviewer &&
      t.reviewer.toLowerCase() === from.toLowerCase() &&
      !isAlreadyApproved(t),
    )

  if (validatingTasks.length === 0) {
    return { detected: false, skipped: { reason: 'no_validating_tasks' } }
  }

  // Step 4: Try to resolve target task
  const referencedIds = extractTaskIds(content)

  // 4a: Explicit task reference
  if (referencedIds.length === 1) {
    const targetTask = validatingTasks.find(t =>
      t.id.toLowerCase() === referencedIds[0],
    )
    if (targetTask) {
      return {
        detected: true,
        signal: {
          taskId: targetTask.id,
          reviewer: from,
          source: 'explicit_reference',
          matchedPattern,
          comment: content,
        },
      }
    }
    // Referenced task exists but isn't in reviewer's validating queue
    const anyTask = taskManager.listTasks({}).find(t =>
      t.id.toLowerCase() === referencedIds[0],
    )
    if (anyTask) {
      if (anyTask.status !== 'validating') {
        return { detected: false, skipped: { reason: 'task_not_validating', details: `${anyTask.id} is ${anyTask.status}` } }
      }
      if (anyTask.reviewer?.toLowerCase() !== from.toLowerCase()) {
        return { detected: false, skipped: { reason: 'reviewer_mismatch', details: `reviewer is ${anyTask.reviewer}, not ${from}` } }
      }
      if (isAlreadyApproved(anyTask)) {
        return { detected: false, skipped: { reason: 'already_approved', details: anyTask.id } }
      }
    }
    // Referenced task not found — fall through to sole-validating logic
  }

  if (referencedIds.length > 1) {
    // Multiple task references — too ambiguous
    return {
      detected: false,
      skipped: {
        reason: 'ambiguous_tasks',
        details: `Multiple task IDs referenced: ${referencedIds.join(', ')}`,
      },
    }
  }

  // 4b: Sole validating task
  if (validatingTasks.length === 1) {
    return {
      detected: true,
      signal: {
        taskId: validatingTasks[0].id,
        reviewer: from,
        source: 'sole_validating',
        matchedPattern,
        comment: content,
      },
    }
  }

  // 4c: Multiple validating tasks, no explicit reference
  return {
    detected: false,
    skipped: {
      reason: 'ambiguous_tasks',
      details: `${validatingTasks.length} validating tasks for reviewer ${from}: ${validatingTasks.map(t => t.id).join(', ')}`,
    },
  }
}

/**
 * Apply an approval signal by updating the task metadata.
 * Returns the updated task or null if the update failed.
 */
export async function applyApproval(
  signal: ApprovalSignal,
): Promise<Task | undefined> {
  const now = Date.now()
  const task = taskManager.getTask(signal.taskId)
  if (!task) return undefined

  // Double-check guard: don't approve twice
  if (isAlreadyApproved(task)) return task

  // Auto-transition validating → done (matches POST /tasks/:id/review behavior)
  const autoTransition = task.status === 'validating'

  const updated = await taskManager.updateTask(signal.taskId, {
    ...(autoTransition ? { status: 'done' as const } : {}),
    metadata: {
      ...(task.metadata || {}),
      reviewer_approved: true,
      reviewer_decision: {
        decision: 'approved',
        reviewer: signal.reviewer,
        comment: `[auto-detected from chat] ${signal.comment}`,
        decidedAt: now,
        source: 'chat-approval-detector',
        resolution: signal.source,
      },
      reviewer_notes: signal.comment,
      actor: signal.reviewer,
      review_state: 'approved',
      review_last_activity_at: now,
      ...(autoTransition ? {
        auto_closed: true,
        auto_closed_at: now,
        auto_close_reason: 'chat_approval_auto_transition',
        completed_at: now,
      } : {}),
    },
  })

  if (updated) {
    const sourceLabel = signal.source === 'explicit_reference'
      ? `(referenced ${signal.taskId} in message)`
      : `(sole validating task for ${signal.reviewer})`

    const transitionNote = autoTransition ? ' Auto-transitioned validating → done.' : ''

    await taskManager.addTaskComment(
      signal.taskId,
      'system',
      `[review] auto-approved: Detected approval signal from @${signal.reviewer} in chat ${sourceLabel}.${transitionNote} Pattern: \`${signal.matchedPattern}\`. Original message: "${truncate(signal.comment, 200)}"`,
    )
  }

  return updated
}

// ── Helpers ──

function isAlreadyApproved(task: Task): boolean {
  const meta = task.metadata as Record<string, unknown> | undefined
  return meta?.reviewer_approved === true
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max) + '…'
}
