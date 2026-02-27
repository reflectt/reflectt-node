// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * PR Auto-Merge + Task Auto-Close Sync
 *
 * Provides:
 * 1. checkPrMergeability() — checks if a PR is green+approved
 * 2. attemptAutoMerge() — merges via gh CLI, logs failures
 * 3. autoPopulateCloseGate() — fills task metadata from PR data
 * 4. tryAutoCloseTask() — transitions validating→done when gates pass
 */

import { execSync } from 'node:child_process'
import { taskManager } from './tasks.js'
import type { Task } from './types.js'
import { getDuplicateClosureCanonicalRefError } from './duplicateClosureGuard.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface PrMergeability {
  mergeable: boolean
  reason: string
  state: 'OPEN' | 'MERGED' | 'CLOSED' | 'UNKNOWN'
  reviewDecision: string  // APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, etc.
  checksStatus: 'passing' | 'failing' | 'pending' | 'unknown'
  failingChecks: string[]
}

export interface MergeAttemptResult {
  success: boolean
  error: string | null
  mergeCommitSha: string | null
}

export interface CloseGateResult {
  populated: boolean
  fields: string[]  // which fields were auto-populated
  error: string | null
}

export interface AutoCloseResult {
  closed: boolean
  reason: string
  failedGates: string[]
}

export interface MergeAttemptLog {
  taskId: string
  prUrl: string
  timestamp: number
  action: 'merge_attempted' | 'merge_success' | 'merge_failed' | 'merge_skipped' | 'auto_close' | 'close_gate_fail'
  detail: string
}

// ── State ──────────────────────────────────────────────────────────────────

const mergeAttemptLog: MergeAttemptLog[] = []
const MERGE_LOG_MAX = 200

function logMergeAttempt(entry: Omit<MergeAttemptLog, 'timestamp'>): void {
  mergeAttemptLog.push({ ...entry, timestamp: Date.now() })
  if (mergeAttemptLog.length > MERGE_LOG_MAX) {
    mergeAttemptLog.splice(0, mergeAttemptLog.length - MERGE_LOG_MAX)
  }
}

export function getMergeAttemptLog(): MergeAttemptLog[] {
  return [...mergeAttemptLog]
}

// Cache to avoid hammering gh CLI on the same PR within a sweep cycle
const mergeabilityCache = new Map<string, { result: PrMergeability; cachedAt: number }>()
const MERGEABILITY_CACHE_TTL_MS = 3 * 60 * 1000 // 3 minutes

export function _clearMergeabilityCache(): void {
  mergeabilityCache.clear()
}

// ── Parse PR URL ───────────────────────────────────────────────────────────

export function parsePrUrl(prUrl: string): { repo: string; prNumber: number } | null {
  const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  if (!match) return null
  const prNumber = parseInt(match[2], 10)
  if (prNumber <= 0) return null
  return { repo: match[1], prNumber }
}

// ── Check PR Mergeability ──────────────────────────────────────────────────

export function checkPrMergeability(prUrl: string): PrMergeability {
  const cached = mergeabilityCache.get(prUrl)
  if (cached && Date.now() - cached.cachedAt < MERGEABILITY_CACHE_TTL_MS) {
    return cached.result
  }

  const parsed = parsePrUrl(prUrl)
  if (!parsed) {
    const result: PrMergeability = {
      mergeable: false,
      reason: 'Invalid PR URL format',
      state: 'UNKNOWN',
      reviewDecision: 'UNKNOWN',
      checksStatus: 'unknown',
      failingChecks: [],
    }
    return result
  }

  try {
    const raw = execSync(
      `gh pr view ${parsed.prNumber} --repo ${parsed.repo} --json state,reviewDecision,statusCheckRollup,mergeCommit`,
      { timeout: 15_000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()

    const data = JSON.parse(raw)
    const state = (data.state || 'UNKNOWN').toUpperCase()
    const reviewDecision = (data.reviewDecision || 'UNKNOWN').toUpperCase()

    // Parse status checks
    const checks = data.statusCheckRollup || []
    const failingChecks: string[] = []
    let checksStatus: PrMergeability['checksStatus'] = 'passing'

    if (checks.length === 0) {
      checksStatus = 'unknown'
    } else {
      let hasPending = false
      for (const check of checks) {
        const conclusion = (check.conclusion || check.status || '').toUpperCase()
        if (conclusion === 'FAILURE' || conclusion === 'ERROR' || conclusion === 'CANCELLED' || conclusion === 'TIMED_OUT') {
          failingChecks.push(check.name || check.context || 'unknown check')
          checksStatus = 'failing'
        } else if (conclusion === 'PENDING' || conclusion === 'IN_PROGRESS' || conclusion === 'QUEUED') {
          hasPending = true
        }
      }
      if (checksStatus !== 'failing' && hasPending) {
        checksStatus = 'pending'
      }
    }

    // Determine mergeability
    let mergeable = false
    let reason = ''

    if (state !== 'OPEN') {
      reason = `PR is ${state} (not open)`
    } else if (reviewDecision !== 'APPROVED') {
      reason = `Review decision: ${reviewDecision} (need APPROVED)`
    } else if (checksStatus === 'failing') {
      reason = `Failing checks: ${failingChecks.join(', ')}`
    } else if (checksStatus === 'pending') {
      reason = 'Checks still pending'
    } else {
      mergeable = true
      reason = 'PR is green and approved'
    }

    const result: PrMergeability = {
      mergeable,
      reason,
      state: state as PrMergeability['state'],
      reviewDecision,
      checksStatus,
      failingChecks,
    }

    mergeabilityCache.set(prUrl, { result, cachedAt: Date.now() })
    return result
  } catch (err: any) {
    const result: PrMergeability = {
      mergeable: false,
      reason: `gh CLI error: ${err?.message || 'unknown error'}`,
      state: 'UNKNOWN',
      reviewDecision: 'UNKNOWN',
      checksStatus: 'unknown',
      failingChecks: [],
    }
    mergeabilityCache.set(prUrl, { result, cachedAt: Date.now() })
    return result
  }
}

// ── Attempt Auto-Merge ─────────────────────────────────────────────────────

export function attemptAutoMerge(prUrl: string): MergeAttemptResult {
  const parsed = parsePrUrl(prUrl)
  if (!parsed) {
    return { success: false, error: 'Invalid PR URL format', mergeCommitSha: null }
  }

  try {
    execSync(
      `gh pr merge ${parsed.prNumber} --repo ${parsed.repo} --squash --auto`,
      { timeout: 30_000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    )

    // Try to get the merge commit SHA
    let mergeCommitSha: string | null = null
    try {
      const viewRaw = execSync(
        `gh pr view ${parsed.prNumber} --repo ${parsed.repo} --json mergeCommit --jq .mergeCommit.oid`,
        { timeout: 10_000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim()
      if (viewRaw && viewRaw.length >= 7) {
        mergeCommitSha = viewRaw
      }
    } catch {
      // Non-critical — merge may still be in progress
    }

    console.log(`[AutoMerge] Successfully merged PR ${prUrl}`)
    return { success: true, error: null, mergeCommitSha }
  } catch (err: any) {
    const errorMsg = err?.stderr?.toString?.() || err?.message || 'Unknown merge error'
    console.log(`[AutoMerge] Merge failed for ${prUrl}: ${errorMsg}`)
    return { success: false, error: errorMsg, mergeCommitSha: null }
  }
}

// ── Auto-Populate Close-Gate Metadata ──────────────────────────────────────

export function autoPopulateCloseGate(taskId: string, prUrl?: string): CloseGateResult {
  const lookup = taskManager.resolveTaskId(taskId)
  if (!lookup.task || !lookup.resolvedId) {
    return { populated: false, fields: [], error: `Task ${taskId} not found` }
  }

  const task = lookup.task
  const meta = { ...(task.metadata || {}) } as Record<string, unknown>
  const populated: string[] = []

  // Auto-set pr_merged
  if (!meta.pr_merged) {
    meta.pr_merged = true
    populated.push('pr_merged')
  }

  // Auto-set pr_merged_at
  if (!meta.pr_merged_at) {
    meta.pr_merged_at = Date.now()
    populated.push('pr_merged_at')
  }

  // Auto-set pr_url
  if (!meta.pr_url && prUrl) {
    meta.pr_url = prUrl
    populated.push('pr_url')
  }

  // Auto-set artifacts array
  const effectivePrUrl = prUrl || (meta.pr_url as string)
  if (effectivePrUrl) {
    const artifacts = Array.isArray(meta.artifacts) ? [...meta.artifacts] : []
    if (!artifacts.includes(effectivePrUrl)) {
      artifacts.push(effectivePrUrl)
      meta.artifacts = artifacts
      populated.push('artifacts')
    }
  }

  // Auto-generate artifact_path if missing
  if (!meta.artifact_path) {
    const shortId = taskId.split('-').pop()
    meta.artifact_path = `process/TASK-${shortId}.md`
    populated.push('artifact_path')
  }

  // Try to extract commit SHA from PR via gh
  if (!meta.commit_sha && effectivePrUrl) {
    const parsed = parsePrUrl(effectivePrUrl)
    if (parsed) {
      try {
        const sha = execSync(
          `gh pr view ${parsed.prNumber} --repo ${parsed.repo} --json mergeCommit --jq .mergeCommit.oid`,
          { timeout: 10_000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
        ).trim()
        if (sha && sha.length >= 7) {
          meta.commit_sha = sha
          populated.push('commit_sha')

          // Also populate review_handoff.commit_sha if review_handoff exists
          const rh = meta.review_handoff as Record<string, unknown> | undefined
          if (rh && !rh.commit_sha) {
            rh.commit_sha = sha
            meta.review_handoff = rh
            populated.push('review_handoff.commit_sha')
          }
        }
      } catch {
        // Non-critical
      }
    }
  }

  // Apply
  if (populated.length > 0) {
    try {
      taskManager.updateTask(lookup.resolvedId, { metadata: meta })
      console.log(`[AutoMerge] Auto-populated close-gate for ${taskId}: ${populated.join(', ')}`)
      return { populated: true, fields: populated, error: null }
    } catch (err: any) {
      return { populated: false, fields: [], error: err?.message || 'Update failed' }
    }
  }

  return { populated: false, fields: [], error: null }
}

// ── Try Auto-Close Task ────────────────────────────────────────────────────

export function tryAutoCloseTask(taskId: string): AutoCloseResult {
  const lookup = taskManager.resolveTaskId(taskId)
  if (!lookup.task || !lookup.resolvedId) {
    return { closed: false, reason: `Task ${taskId} not found`, failedGates: ['task_exists'] }
  }

  const task = lookup.task
  if (task.status !== 'validating') {
    return { closed: false, reason: `Task is ${task.status}, not validating`, failedGates: [] }
  }

  const meta = (task.metadata || {}) as Record<string, unknown>
  const failedGates: string[] = []

  // Gate: PR must be merged
  if (!meta.pr_merged) {
    failedGates.push('pr_merged')
  }

  // Gate: reviewer must have approved
  if (!meta.reviewer_approved) {
    failedGates.push('reviewer_approved')
  }

  // Gate: review_state must not be rejected/changes_requested
  // This prevents auto-close when a reviewer has explicitly rejected,
  // even if reviewer_approved was set from a prior approval cycle.
  const reviewState = meta.review_state as string | undefined
  const reviewerDecision = meta.reviewer_decision as { decision?: string } | undefined
  if (reviewState === 'changes_requested' || reviewState === 'rejected') {
    failedGates.push(`review_state_blocked:${reviewState}`)
  }
  if (reviewerDecision?.decision === 'rejected') {
    failedGates.push('reviewer_decision_rejected')
  }

  // Gate: artifact_path must exist
  if (!meta.artifact_path) {
    failedGates.push('artifact_path')
  }

  if (failedGates.length > 0) {
    const reason = `Close gates not met: ${failedGates.join(', ')}`
    console.log(`[AutoMerge] Cannot auto-close ${taskId}: ${reason}`)
    logMergeAttempt({
      taskId,
      prUrl: (meta.pr_url as string) || 'unknown',
      action: 'close_gate_fail',
      detail: reason,
    })
    return { closed: false, reason, failedGates }
  }

  // Duplicate-closure contract: don't auto-close into a churny N/A packet.
  // If this is a duplicate closure, require canonical refs; otherwise refuse auto-close.
  const dupeErr = getDuplicateClosureCanonicalRefError(meta)
  if (dupeErr) {
    const reason = `Duplicate closure missing canonical refs: ${dupeErr}`
    console.log(`[AutoMerge] Cannot auto-close ${taskId}: ${reason}`)

    // Refuse auto-close and requeue to todo so the author can attach canonical refs.
    taskManager.updateTask(lookup.resolvedId, {
      status: 'todo',
      metadata: {
        ...meta,
        auto_close_blocked: true,
        auto_close_blocked_at: Date.now(),
        auto_close_blocked_reason: reason,
        review_state: 'needs_author',
        reviewer_approved: undefined,
        reviewer_decision: undefined,
        reviewer_notes: undefined,
      },
    } as any).catch(() => {})

    logMergeAttempt({
      taskId,
      prUrl: (meta.pr_url as string) || 'unknown',
      action: 'close_gate_fail',
      detail: reason,
    })
    return { closed: false, reason, failedGates: ['duplicate_canonical_refs'] }
  }

  // All gates pass — transition to done
  try {
    taskManager.updateTask(lookup.resolvedId, {
      status: 'done',
      metadata: {
        ...meta,
        auto_closed: true,
        auto_closed_at: Date.now(),
      },
    })
    console.log(`[AutoMerge] Auto-closed task ${taskId} (all gates satisfied)`)
    logMergeAttempt({
      taskId,
      prUrl: (meta.pr_url as string) || 'unknown',
      action: 'auto_close',
      detail: 'All close gates satisfied, task moved to done',
    })
    return { closed: true, reason: 'All close gates satisfied', failedGates: [] }
  } catch (err: any) {
    const reason = `Failed to update task: ${err?.message || 'unknown error'}`
    console.log(`[AutoMerge] Auto-close failed for ${taskId}: ${reason}`)
    return { closed: false, reason, failedGates: [] }
  }
}

// ── Sweep Integration: Process Validating Tasks ────────────────────────────

/**
 * Called by the execution sweeper during each cycle.
 * For each validating task with a PR, checks mergeability and attempts merge.
 * After merge, auto-populates close gates and tries to auto-close.
 */
export function processAutoMerge(tasks: Task[]): {
  mergeAttempts: number
  mergeSuccesses: number
  autoCloses: number
  skipped: number
} {
  const validating = tasks.filter(t => t.status === 'validating')
  let mergeAttempts = 0
  let mergeSuccesses = 0
  let autoCloses = 0
  let skipped = 0

  for (const task of validating) {
    const meta = (task.metadata || {}) as Record<string, unknown>

    // Skip if already merged — just try auto-close
    if (meta.pr_merged) {
      const closeResult = tryAutoCloseTask(task.id)
      if (closeResult.closed) autoCloses++
      continue
    }

    // Find PR URL
    const prUrl = extractTaskPrUrl(meta)
    if (!prUrl) {
      skipped++
      continue
    }

    // Check mergeability
    const mergeability = checkPrMergeability(prUrl)

    if (mergeability.state === 'MERGED') {
      // PR already merged but task doesn't know — populate + try close
      autoPopulateCloseGate(task.id, prUrl)
      const closeResult = tryAutoCloseTask(task.id)
      if (closeResult.closed) autoCloses++
      logMergeAttempt({
        taskId: task.id,
        prUrl,
        action: 'merge_skipped',
        detail: 'PR already merged, auto-populated close gates',
      })
      continue
    }

    if (!mergeability.mergeable) {
      logMergeAttempt({
        taskId: task.id,
        prUrl,
        action: 'merge_skipped',
        detail: mergeability.reason,
      })
      skipped++
      continue
    }

    // Attempt merge
    mergeAttempts++
    logMergeAttempt({
      taskId: task.id,
      prUrl,
      action: 'merge_attempted',
      detail: 'PR is green and approved, attempting auto-merge',
    })

    const mergeResult = attemptAutoMerge(prUrl)

    if (mergeResult.success) {
      mergeSuccesses++
      logMergeAttempt({
        taskId: task.id,
        prUrl,
        action: 'merge_success',
        detail: `Merged successfully${mergeResult.mergeCommitSha ? ` (${mergeResult.mergeCommitSha.slice(0, 7)})` : ''}`,
      })

      // Auto-populate close gate metadata
      autoPopulateCloseGate(task.id, prUrl)
      if (mergeResult.mergeCommitSha) {
        try {
          const freshTask = taskManager.getTask(task.id)
          if (freshTask) {
            taskManager.updateTask(task.id, {
              metadata: {
                ...(freshTask.metadata || {}),
                commit_sha: mergeResult.mergeCommitSha,
              },
            })
          }
        } catch {
          // Non-critical
        }
      }

      // Try auto-close
      const closeResult = tryAutoCloseTask(task.id)
      if (closeResult.closed) autoCloses++
    } else {
      logMergeAttempt({
        taskId: task.id,
        prUrl,
        action: 'merge_failed',
        detail: mergeResult.error || 'Unknown error',
      })
    }
  }

  return { mergeAttempts, mergeSuccesses, autoCloses, skipped }
}

// ── Helper: Extract PR URL from task metadata ──────────────────────────────

function extractTaskPrUrl(meta: Record<string, unknown>): string | null {
  const reviewHandoff = meta.review_handoff as Record<string, unknown> | undefined
  if (reviewHandoff?.doc_only || reviewHandoff?.config_only) return null

  const candidates: string[] = []
  if (meta.pr_url && typeof meta.pr_url === 'string') candidates.push(meta.pr_url)
  const qaBundle = meta.qa_bundle as Record<string, unknown> | undefined
  if (qaBundle?.pr_link && typeof qaBundle.pr_link === 'string') candidates.push(qaBundle.pr_link)
  if (reviewHandoff?.pr_url && typeof reviewHandoff.pr_url === 'string') candidates.push(reviewHandoff.pr_url)
  const artifacts = meta.artifacts as string[] | undefined
  if (artifacts?.length) {
    const ghPr = artifacts.find(a => typeof a === 'string' && a.includes('github.com') && a.includes('/pull/'))
    if (ghPr) candidates.push(ghPr)
  }

  for (const url of candidates) {
    const match = url.match(/\/pull\/(\d+)/)
    if (match && parseInt(match[1], 10) > 0) return url
  }
  return null
}

// ── Remediation Strings ────────────────────────────────────────────────────

/**
 * Generate exact remediation instructions for a drift issue.
 */
export function generateRemediation(params: {
  taskId: string
  issue: string
  prUrl?: string
  meta?: Record<string, unknown>
}): string {
  const { taskId, issue, prUrl, meta } = params
  const parsed = prUrl ? parsePrUrl(prUrl) : null

  switch (issue) {
    case 'stale_validating':
      return `Reviewer needs to act. Remediation:\n` +
        `  1. Review the PR${prUrl ? ` at ${prUrl}` : ''}\n` +
        `  2. Then: PATCH /tasks/${taskId} { "metadata": { "reviewer_approved": true } }`

    case 'pr_merged_not_closed':
      return `PR merged but task still validating. Remediation:\n` +
        `  PATCH /tasks/${taskId} { "status": "done", "metadata": { "reviewer_approved": true } }\n` +
        `  Or if not ready: PATCH /tasks/${taskId} { "metadata": { "reviewer_approved": true } } (auto-close will handle the rest)`

    case 'orphan_pr':
      return `PR may still be open after task completion. Remediation:\n` +
        (parsed
          ? `  gh pr merge ${parsed.prNumber} --repo ${parsed.repo} --squash\n  Or: gh pr close ${parsed.prNumber} --repo ${parsed.repo}`
          : `  Close or merge the PR manually`)

    case 'no_pr_linked':
      return `No PR URL in task metadata. Remediation:\n` +
        `  PATCH /tasks/${taskId} { "metadata": { "pr_url": "https://github.com/OWNER/REPO/pull/NUM" } }`

    default:
      return 'No automated remediation available'
  }
}
