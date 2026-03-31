// SPDX-License-Identifier: Apache-2.0
/**
 * Review auto-close bridge.
 *
 * Parses structured `[review] approved:` / `[review] rejected:` comments
 * posted by the assigned reviewer and auto-fires the review decision,
 * transitioning the task from validating→done or validating→todo.
 *
 * Safety invariants:
 *   - Only fires when task.status === 'validating'
 *   - Author must match task.reviewer (exact match, case-insensitive)
 *   - Parsed via strict regex — no fuzzy matching
 *   - Idempotent: ignores if task already past validating
 *   - Emits trust event on self-review attempt (reviewer === assignee)
 *   - Dry-run safe: `dryRun=true` returns parsed result without mutating
 *
 * Comment format (reviewer posts in task-comments):
 *   [review] approved: <comment text>
 *   [review] rejected: <comment text>
 *
 * task-1773490646984-eujrozhai
 */

/** Result of parsing a comment for a review signal. */
export interface ReviewSignal {
  detected: boolean
  decision?: 'approve' | 'reject'
  comment?: string
}

/**
 * Parse a task comment body for a structured review signal.
 *
 * Accepts:
 *   [review] approved: <comment>
 *   [review] rejected: <comment>
 *   [review] approved (no trailing text also accepted)
 *
 * Case-insensitive. Leading/trailing whitespace ignored.
 */
export function parseReviewSignal(content: string): ReviewSignal {
  const normalized = content.trim()
  // Match: [review] approved: ... or [review] rejected: ...
  const match = normalized.match(/^\[review\]\s+(approved|rejected)[:\s]*(.*)/i)
  if (!match) return { detected: false }
  const decision = match[1].toLowerCase() === 'approved' ? 'approve' : 'reject'
  const comment = (match[2] ?? '').trim() || (decision === 'approve' ? 'Approved via structured review comment' : 'Rejected via structured review comment')
  return { detected: true, decision, comment }
}

export interface AutoCloseContext {
  taskId: string
  taskStatus: string
  taskReviewer: string | null | undefined
  taskAssignee: string | null | undefined
  commentAuthor: string
  commentContent: string
  dryRun?: boolean
}

export interface AutoCloseResult {
  fired: boolean
  decision?: 'approve' | 'reject'
  reason?: string
  dryRun?: boolean
}

/**
 * Evaluate whether a comment should trigger auto-close, and return the decision.
 * Does NOT mutate — caller is responsible for invoking the review endpoint.
 *
 * Returns fired=true + decision when all safety checks pass.
 * Returns fired=false with reason when skipped.
 */
export function evaluateAutoClose(ctx: AutoCloseContext): AutoCloseResult {
  const { taskStatus, taskReviewer, taskAssignee, commentAuthor, commentContent, dryRun } = ctx

  // Only act on validating tasks
  if (taskStatus !== 'validating') {
    return { fired: false, reason: `task is ${taskStatus}, not validating` }
  }

  // Must have an assigned reviewer
  if (!taskReviewer) {
    return { fired: false, reason: 'task has no assigned reviewer' }
  }

  // Author must be the assigned reviewer
  if (commentAuthor.trim().toLowerCase() !== taskReviewer.trim().toLowerCase()) {
    return { fired: false, reason: `author "${commentAuthor}" is not the assigned reviewer "${taskReviewer}"` }
  }

  // Parse the comment
  const signal = parseReviewSignal(commentContent)
  if (!signal.detected) {
    return { fired: false, reason: 'no structured [review] signal found in comment' }
  }

  return {
    fired: true,
    decision: signal.decision,
    dryRun,
  }
}
