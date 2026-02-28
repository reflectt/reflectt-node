// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Execution Sweeper — Zero-Leak Enforcement
 * 
 * Periodically scans for:
 * 1. Stale validating tasks (no reviewer activity within SLA)
 * 2. Open PRs not linked to active tasks (orphan PRs)
 * 3. Task/PR state drift (merged PR but task still validating)
 * 
 * Escalates via chat messages when thresholds are breached.
 * Provides drift report endpoint for full visibility.
 */

import { taskManager } from './tasks.js'
import { chatManager } from './chat.js'
import type { Task } from './types.js'
import { execSync } from 'child_process'
import { processAutoMerge, generateRemediation } from './prAutoMerge.js'
import { preflightCheck, type PreflightInput } from './alert-preflight.js'

/**
 * Send an alert message through chatManager with preflight guard.
 * If preflight suppresses the alert (in enforce mode), the message is not sent.
 * In canary mode, it logs but still sends.
 */
async function sendAlertWithPreflight(
  msg: { from: string; channel: string; content: string },
  preflight: Omit<PreflightInput, 'content' | 'channel'>,
): Promise<void> {
  const result = preflightCheck({
    ...preflight,
    content: msg.content,
    channel: msg.channel,
  })
  if (!result.proceed) {
    console.log(`[Sweeper] Alert suppressed by preflight: ${result.reason} (key: ${result.idempotentKey})`)
    return
  }
  await chatManager.sendMessage(msg)
}
import { msToMinutes, formatDuration } from './format-duration.js'
import { suggestReviewer } from './assignment.js'
import { getDuplicateClosureCanonicalRefError } from './duplicateClosureGuard.js'

// ── Live PR State Check ────────────────────────────────────────────────────

export interface LivePrState {
  state: 'open' | 'merged' | 'closed' | 'unknown'
  error?: string
}

/**
 * Check live PR state via `gh` CLI. Returns 'unknown' if gh is unavailable.
 * Results are cached for the duration of one sweep cycle to avoid rate limits.
 */
const prStateCache = new Map<string, { state: LivePrState; cachedAt: number }>()
const PR_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function checkLivePrState(prUrl: string): LivePrState {
  const now = Date.now()
  const cached = prStateCache.get(prUrl)
  if (cached && (now - cached.cachedAt) < PR_CACHE_TTL_MS) {
    return cached.state
  }

  try {
    // Extract owner/repo and PR number from URL
    const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
    if (!match) return { state: 'unknown', error: 'Invalid PR URL format' }

    const [, repo, prNumber] = match
    const raw = execSync(
      `gh pr view ${prNumber} --repo ${repo} --json state --jq .state`,
      { timeout: 10_000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim().toUpperCase()

    let state: LivePrState['state'] = 'unknown'
    if (raw === 'OPEN') state = 'open'
    else if (raw === 'MERGED') state = 'merged'
    else if (raw === 'CLOSED') state = 'closed'

    const result: LivePrState = { state }
    prStateCache.set(prUrl, { state: result, cachedAt: now })
    return result
  } catch (err) {
    const result: LivePrState = { state: 'unknown', error: String(err) }
    prStateCache.set(prUrl, { state: result, cachedAt: now })
    return result
  }
}

/** Clear PR state cache (for testing) */
export function _clearPrStateCache(): void {
  prStateCache.clear()
}

// ── Configuration ──────────────────────────────────────────────────────────

/** How often the sweeper runs (ms) */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/** Validating SLA: escalate after this many ms without reviewer activity */
const VALIDATING_SLA_MS = 2 * 60 * 60 * 1000 // 2 hours (was 30m — too aggressive for async AI review)

/** Critical SLA: second escalation tier */
const VALIDATING_CRITICAL_MS = 8 * 60 * 60 * 1000 // 8 hours (was 60m — reviewers aren't real-time)

/** Auto-reassign reviewer after this much time without reviewer activity */
const VALIDATING_REASSIGN_MS = 2 * 60 * 60 * 1000 // 2 hours

/** PR age threshold: flag PRs linked to non-active tasks older than this */
const ORPHAN_PR_THRESHOLD_MS = 2 * 60 * 60 * 1000 // 2 hours

/** Re-escalation cooldown: don't re-alert the same task within this window */
const ESCALATION_COOLDOWN_MS = 4 * 60 * 60 * 1000 // 4 hours

/** Artifact grace period: validating tasks without artifacts after this are auto-rejected */
const ARTIFACT_GRACE_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * @deprecated Use formatDuration(ms) from format-duration.ts instead.
 * Kept temporarily for reference; all call sites now use formatDuration().
 */

/** Max escalation count per task before silencing */
const MAX_ESCALATION_COUNT = 3

/** Track which tasks we've already escalated (avoid spam) — in-memory cache */
const escalated = new Map<string, { level: 'warning' | 'critical'; at: number }>()

/** Track which orphan PRs we've already flagged */
const flaggedOrphanPRs = new Set<string>()

/** Track sweep stats for the /execution-health endpoint */
let lastSweepAt = 0
let lastSweepResults: SweepResult | null = null

/** Dry-run log for 24h evidence capture */
const dryRunLog: Array<{ timestamp: number; event: string; detail: string }> = []
const DRY_RUN_LOG_MAX = 500

function logDryRun(event: string, detail: string): void {
  dryRunLog.push({ timestamp: Date.now(), event, detail })
  if (dryRunLog.length > DRY_RUN_LOG_MAX) {
    dryRunLog.splice(0, dryRunLog.length - DRY_RUN_LOG_MAX)
  }
}

export interface SweepViolation {
  taskId: string
  title: string
  assignee?: string
  reviewer?: string
  type: 'validating_sla' | 'validating_critical' | 'pr_drift' | 'orphan_pr'
  age_minutes: number
  message: string
  remediation?: string
}

export interface SweepResult {
  timestamp: number
  violations: SweepViolation[]
  tasksScanned: number
  validatingCount: number
  autoClosedCount?: number
  artifactRejectedCount?: number
}

export interface DriftReportEntry {
  taskId: string
  title: string
  status: string
  assignee?: string
  reviewer?: string
  age_minutes: number
  prUrl?: string
  prMerged?: boolean
  issue: 'stale_validating' | 'orphan_pr' | 'pr_merged_not_closed' | 'no_pr_linked' | 'clean'
  detail: string
  remediation?: string
}

export interface DriftReport {
  timestamp: number
  validating: DriftReportEntry[]
  orphanPRs: DriftReportEntry[]
  summary: {
    totalValidating: number
    staleValidating: number
    orphanPRCount: number
    prDriftCount: number
    cleanCount: number
  }
}

// ── Auto-close eligibility ─────────────────────────────────────────────────

/**
 * Determines if a validating task can be auto-closed (no manual reviewer action needed).
 * 
 * Conditions (ALL must be true):
 * 1. metadata.reconciled === true (task was created from insight reconciliation)
 * 2. Review is approved (reviewer_approved=true OR review_state='approved')
 * 3. No code delta is required (no pr_url, or PR is already merged)
 */
export function isAutoClosable(task: Task, meta: Record<string, unknown>): boolean {
  // Must be reconciled
  if (!meta.reconciled) return false

  // Must have reviewer approval or approved review state
  const reviewApproved = meta.reviewer_approved === true || meta.review_state === 'approved'
  if (!reviewApproved) return false

  // If there's a PR URL, it must already be merged to auto-close
  const prUrl = extractPrUrl(meta)
  if (prUrl) {
    const prMerged = meta.pr_merged === true || meta.merge_commit
    if (!prMerged) return false
  }

  return true
}

// ── Core Sweep Logic ───────────────────────────────────────────────────────

export async function sweepValidatingQueue(): Promise<SweepResult> {
  const now = Date.now()

  // Snapshot tasks for load-balanced reviewer reassignment decisions
  const tasksForScoring = taskManager.listTasks({}).map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    assignee: t.assignee,
    reviewer: t.reviewer,
    tags: t.metadata?.tags as string[] | undefined,
    metadata: t.metadata,
  }))

  const validating = taskManager.listTasks({ status: 'validating' })
  const doneTasks = taskManager.listTasks({ status: 'done' })
  const doingTasks = taskManager.listTasks({ status: 'doing' })
  const todoTasks = taskManager.listTasks({ status: 'todo' })
  const totalScanned = validating.length + doneTasks.length + doingTasks.length + todoTasks.length
  const violations: SweepViolation[] = []

  // ── Auto-close reconciled validating tasks ────────────────────────────
  // Reconciled tasks (metadata.reconciled=true) with an approved review
  // or evidence packet and no code delta required can be auto-closed
  // to prevent SLA noise.
  const autoClosedIds = new Set<string>()

  for (const task of validating) {
    const meta = (task.metadata || {}) as Record<string, unknown>
    if (isAutoClosable(task, meta)) {
      const dupeErr = getDuplicateClosureCanonicalRefError(meta)
      if (dupeErr) {
        // Don't auto-close into a churny N/A duplicate packet — requeue for canonical refs.
        try {
          await taskManager.updateTask(task.id, {
            status: 'todo',
            metadata: {
              ...meta,
              auto_close_blocked: true,
              auto_close_blocked_at: now,
              auto_close_blocked_reason: dupeErr,
              review_state: 'needs_author',
              reviewer_approved: undefined,
              reviewer_decision: undefined,
              reviewer_notes: undefined,
            },
          } as any)
          chatManager.sendMessage({
            from: 'system',
            channel: 'task-notifications',
            content: `⚠️ Auto-close blocked for duplicate closure without canonical refs: ${task.id}. Requeued to todo. @${task.assignee || 'unassigned'} please set duplicate_of + canonical_pr + canonical_commit.`,
          }).catch(() => {})
        } catch {}
        continue
      }

      try {
        await taskManager.updateTask(task.id, {
          status: 'done',
          metadata: {
            ...meta,
            auto_closed: true,
            auto_closed_at: now,
            auto_close_reason: 'reconciled_no_code_delta',
            source_insight: meta.source_insight || meta.insight_id || null,
            source_reflection: meta.source_reflection || null,
          },
        } as any)
        autoClosedIds.add(task.id)
        escalated.delete(task.id)
        logDryRun('auto_closed_reconciled', `${task.id} — reconciled + approved, no code delta required`)

        // Notify in chat
        chatManager.sendMessage({
          from: 'system',
          channel: 'task-notifications',
          content: `✅ Auto-closed reconciled task "${task.title}" (${task.id}) — no code delta required. Insight: ${meta.source_insight || meta.insight_id || 'N/A'}`,
        }).catch(() => {})

        continue
      } catch (err) {
        logDryRun('auto_close_failed', `${task.id} — ${String(err)}`)
      }
    }
  }

  // Filter out auto-closed tasks from further checks
  const remainingValidating = validating.filter(t => !autoClosedIds.has(t.id))

  // ── Artifact grace period: auto-reject tasks missing artifacts after 24h ──
  const artifactRejectedIds = new Set<string>()
  for (const task of remainingValidating) {
    const meta = (task.metadata || {}) as Record<string, unknown>
    const enteredAt = (meta.entered_validating_at as number) || task.updatedAt
    const ageInValidating = now - enteredAt

    if (ageInValidating >= ARTIFACT_GRACE_MS && !hasRequiredArtifacts(meta)) {
      try {
        taskManager.updateTask(task.id, {
          status: 'todo',
          metadata: {
            ...meta,
            artifact_rejected: true,
            artifact_rejected_at: now,
            artifact_reject_reason: 'Missing required artifacts (PR or qa_bundle) after 24h grace period',
            review_state: undefined,
            reviewer_approved: undefined,
          },
        } as any)
        artifactRejectedIds.add(task.id)
        escalated.delete(task.id)
        logDryRun('artifact_rejected', `${task.id} — no artifacts after ${msToMinutes(ageInValidating)}m in validating`)

        chatManager.sendMessage({
          from: 'system',
          channel: 'task-notifications',
          content: `⚠️ Auto-rejected "${task.title}" (${task.id}) back to todo — missing required artifacts (PR or qa_bundle) after 24h in validating. @${task.assignee || 'unassigned'} please add artifacts and resubmit.`,
        }).catch(() => {})
      } catch (err) {
        logDryRun('artifact_reject_failed', `${task.id} — ${String(err)}`)
      }
    }
  }

  // Filter out artifact-rejected tasks from SLA checks
  const slaValidating = remainingValidating.filter(t => !artifactRejectedIds.has(t.id))

  for (const task of slaValidating) {
    const meta = (task.metadata || {}) as Record<string, unknown>

    // Auto-close approved tasks still stuck in validating (drift repair)
    // This catches chat approvals or any path that set reviewer_approved
    // without transitioning status to done.
    const reviewState = meta.review_state as string | undefined
    const reviewerApproved = meta.reviewer_approved === true
    if (reviewState === 'approved' || reviewerApproved) {
      const dupeErr = getDuplicateClosureCanonicalRefError(meta)
      if (dupeErr) {
        try {
          await taskManager.updateTask(task.id, {
            status: 'todo',
            metadata: {
              ...meta,
              auto_close_blocked: true,
              auto_close_blocked_at: now,
              auto_close_blocked_reason: dupeErr,
              review_state: 'needs_author',
              reviewer_approved: undefined,
              reviewer_decision: undefined,
              reviewer_notes: undefined,
            },
          } as any)
          chatManager.sendMessage({
            from: 'system',
            channel: 'task-notifications',
            content: `⚠️ Drift-repair auto-close blocked for duplicate closure without canonical refs: ${task.id}. Requeued to todo.`,
          }).catch(() => {})
        } catch {}
        continue
      }

      try {
        await taskManager.updateTask(task.id, {
          status: 'done',
          metadata: {
            ...meta,
            auto_closed: true,
            auto_closed_at: now,
            auto_close_reason: 'sweeper_drift_repair_approved',
            completed_at: now,
          },
        } as any)
        autoClosedIds.add(task.id)
        escalated.delete(task.id)
        logDryRun('drift_repair_auto_closed', `${task.id} — approved but stuck in validating, auto-closed`)

        chatManager.sendMessage({
          from: 'system',
          channel: 'task-notifications',
          content: `✅ Drift repair: auto-closed "${task.title}" (${task.id}) — was approved but stuck in validating. reviewer: @${task.reviewer || 'unknown'}`,
        }).catch(() => {})
      } catch (err) {
        logDryRun('drift_repair_auto_close_failed', `${task.id} — ${String(err)}`)
      }
      continue
    }

    const enteredAt = (meta.entered_validating_at as number) || task.updatedAt
    const lastActivity = (meta.review_last_activity_at as number) || enteredAt
    const ageSinceActivity = now - lastActivity
    const ageMinutes = msToMinutes(ageSinceActivity)

    // ── Persistent escalation state (survives restarts) ──────────────
    // Read escalation history from task metadata, not just in-memory map
    const persistedLevel = meta.sweeper_escalation_level as string | undefined
    const persistedAt = meta.sweeper_escalated_at as number | undefined
    const persistedCount = (meta.sweeper_escalation_count as number) || 0

    // Rehydrate in-memory map from metadata on first encounter
    const prev = escalated.get(task.id)
    if (!prev && persistedLevel && persistedAt) {
      escalated.set(task.id, {
        level: persistedLevel as 'warning' | 'critical',
        at: persistedAt,
      })
    }
    const effective = escalated.get(task.id)

    // Auto-reassign reviewer when a task sits in validating too long without activity.
    // This mitigates "stuck in validating" states when the original reviewer is offline.
    if (ageSinceActivity >= VALIDATING_REASSIGN_MS && meta.reviewer_auto_reassigned !== true) {
      try {
        const suggestion = suggestReviewer(
          {
            title: task.title,
            assignee: task.assignee,
            tags: meta.tags as string[] | undefined,
            done_criteria: task.done_criteria,
          },
          tasksForScoring,
        )

        const currentReviewer = (task.reviewer || '').trim()
        const nextReviewer = (suggestion.suggested || '').trim()

        if (currentReviewer && nextReviewer && nextReviewer.toLowerCase() !== currentReviewer.toLowerCase()) {
          await taskManager.updateTask(task.id, {
            reviewer: nextReviewer,
            metadata: {
              ...meta,
              review_state: 'queued',
              review_last_activity_at: now,
              reviewer_previous: currentReviewer,
              reviewer_auto_reassigned: true,
              reviewer_auto_reassigned_at: now,
              reviewer_reassign_reason: 'validating_no_reviewer_activity',
              reviewer_scores: suggestion.scores.slice(0, 3),
            },
          } as any)

          // Mutate local copy so subsequent alerts in this sweep use the new reviewer.
          task.reviewer = nextReviewer

          logDryRun('reviewer_auto_reassigned', `${task.id} — ${currentReviewer} -> ${nextReviewer} after ${ageMinutes}m without reviewer activity`)

          chatManager.sendMessage({
            from: 'system',
            channel: 'task-notifications',
            content: `🔁 Auto-reassigned reviewer for "${task.title}" (${task.id}) after ${ageMinutes}m without reviewer activity: @${currentReviewer} → @${nextReviewer}.`,
          }).catch(() => {})
        }
      } catch (err) {
        logDryRun('reviewer_auto_reassign_failed', `${task.id} — ${String(err)}`)
      }
    }

    // Skip if max escalations reached (silenced)
    if (persistedCount >= MAX_ESCALATION_COUNT) {
      logDryRun('escalation_silenced', `${task.id} — ${persistedCount} escalations, max reached`)
      continue
    }

    // Skip if within cooldown window
    const lastEscalatedAt = effective?.at || persistedAt || 0
    if (lastEscalatedAt && (now - lastEscalatedAt) < ESCALATION_COOLDOWN_MS) {
      continue // Still in cooldown
    }

    if (ageSinceActivity >= VALIDATING_CRITICAL_MS && effective?.level !== 'critical') {
      const prUrl = extractPrUrl(meta)
      const newCount = persistedCount + 1
      violations.push({
        taskId: task.id,
        title: task.title,
        assignee: task.assignee,
        reviewer: task.reviewer,
        type: 'validating_critical',
        age_minutes: ageMinutes,
        message: `🚨 CRITICAL: "${task.title}" (${task.id}) stuck in validating for ${formatDuration(ageSinceActivity)}. @${task.reviewer || 'unassigned'} please review. @${task.assignee || 'unassigned'} — your PR is blocked.`,
        remediation: generateRemediation({ taskId: task.id, issue: 'stale_validating', prUrl: prUrl || undefined, meta }),
      })
      escalated.set(task.id, { level: 'critical', at: now })
      // Persist to task metadata so it survives restarts (lightweight, bypasses lifecycle gates)
      taskManager.patchTaskMetadata(task.id, {
        sweeper_escalation_level: 'critical',
        sweeper_escalated_at: now,
        sweeper_escalation_count: newCount,
      })
      logDryRun('validating_critical', `${task.id} — ${ageMinutes}m — reviewer:${task.reviewer} assignee:${task.assignee} count:${newCount}`)
    } else if (ageSinceActivity >= VALIDATING_SLA_MS && !effective) {
      const prUrl = extractPrUrl(meta)
      const newCount = persistedCount + 1
      violations.push({
        taskId: task.id,
        title: task.title,
        assignee: task.assignee,
        reviewer: task.reviewer,
        type: 'validating_sla',
        age_minutes: ageMinutes,
        message: `⚠️ SLA breach: "${task.title}" (${task.id}) in validating ${formatDuration(ageSinceActivity)}. @${task.reviewer || 'unassigned'} — review needed. @${task.assignee || 'unassigned'} — ping if blocked.`,
        remediation: generateRemediation({ taskId: task.id, issue: 'stale_validating', prUrl: prUrl || undefined, meta }),
      })
      escalated.set(task.id, { level: 'warning', at: now })
      // Persist to task metadata so it survives restarts (lightweight, bypasses lifecycle gates)
      taskManager.patchTaskMetadata(task.id, {
        sweeper_escalation_level: 'warning',
        sweeper_escalated_at: now,
        sweeper_escalation_count: newCount,
      })
      logDryRun('validating_sla', `${task.id} — ${ageMinutes}m — reviewer:${task.reviewer} assignee:${task.assignee} count:${newCount}`)
    }
  }

  // Clean up escalation tracking for tasks no longer validating
  for (const [key] of escalated) {
    // drift: prefix holds the real task ID — strip before resolving
    const realTaskId = key.startsWith('drift:') ? key.slice(6) : key
    const lookup = taskManager.resolveTaskId(realTaskId)
    if (!lookup.task || lookup.task.status !== 'validating') {
      escalated.delete(key)
      // Also clear persisted sweeper metadata when task leaves validating
      if (lookup.task) {
        const meta = (lookup.task.metadata || {}) as Record<string, unknown>
        if (meta.sweeper_escalation_level) {
          taskManager.patchTaskMetadata(realTaskId, {
            sweeper_escalation_level: undefined,
            sweeper_escalated_at: undefined,
            sweeper_escalation_count: undefined,
          })
        }
      }
      logDryRun('escalation_cleared', `${key} — no longer validating`)
    }
  }

  // ── Orphan PR detection ──────────────────────────────────────────────
  // Scan all tasks with PR URLs where the task is done/cancelled but the PR
  // was linked — these represent potential orphan open PRs
  const cancelledTasks = taskManager.listTasks({ status: 'cancelled' as any })
  const doneAndCancelled = [...doneTasks, ...cancelledTasks]
  for (const task of doneAndCancelled) {
    const meta = (task.metadata || {}) as Record<string, unknown>
    const prUrl = extractPrUrl(meta)
    if (!prUrl || flaggedOrphanPRs.has(prUrl)) continue

    // Check if this PR is also referenced by an active task — if so, it's not orphan
    const activeTasks = [...doingTasks, ...validating, ...todoTasks]
    const activeRef = activeTasks.find((t: Task) =>
      t.id !== task.id &&
      extractPrUrl((t.metadata || {}) as Record<string, unknown>) === prUrl
    )
    if (activeRef) continue

    // PR on a done task with no active task referencing it
    // Check metadata flags that indicate the PR was merged/resolved
    const prMerged = !!(meta.pr_merged)
    const reviewerApproved = !!(meta.reviewer_approved)
    const taskDone = task.status === 'done'

    // If metadata says merged, skip
    if (prMerged) continue

    // Skip live PR checks during periodic sweep — execSync blocks the event loop.
    // Orphan PR detection relies on metadata flags only; live checks available via /drift-report.
    if (prMerged || reviewerApproved) continue

    const completedAge = now - task.updatedAt
    if (completedAge >= ORPHAN_PR_THRESHOLD_MS) {
      const assigneeMention = task.assignee ? `@${task.assignee}` : '@unassigned'
      const reviewerMention = task.reviewer ? `@${task.reviewer}` : '@unassigned'
      violations.push({
        taskId: task.id,
        title: task.title,
        assignee: task.assignee,
        reviewer: task.reviewer,
        type: 'orphan_pr',
        age_minutes: msToMinutes(completedAge),
        message: `🔍 Orphan PR detected: ${prUrl} linked to done task "${task.title}" (${task.id}). PR may still be open — ${assigneeMention} close or merge it. ${reviewerMention} — confirm status.`,
        remediation: generateRemediation({ taskId: task.id, issue: 'orphan_pr', prUrl }),
      })
      flaggedOrphanPRs.add(prUrl)
      logDryRun('orphan_pr', `${prUrl} on ${task.id} — task done ${msToMinutes(completedAge)}m ago`)
    }
  }

  // Also check validating tasks for PR drift (merged but not advanced)
  for (const task of validating) {
    const meta = (task.metadata || {}) as Record<string, unknown>
    if (meta.pr_merged && task.status === 'validating') {
      const mergedAt = (meta.pr_merged_at as number) || task.updatedAt
      const driftAge = now - mergedAt
      if (driftAge >= ORPHAN_PR_THRESHOLD_MS && !escalated.has(`drift:${task.id}`)) {
        violations.push({
          taskId: task.id,
          title: task.title,
          assignee: task.assignee,
          reviewer: task.reviewer,
          type: 'pr_drift',
          age_minutes: msToMinutes(driftAge),
          message: `📦 PR merged ${msToMinutes(driftAge)}m ago but "${task.title}" (${task.id}) still in validating. @${task.reviewer || 'unassigned'} — approve or close. @${task.assignee || 'unassigned'} — ping if needed.`,
          remediation: generateRemediation({ taskId: task.id, issue: 'pr_merged_not_closed', prUrl: extractPrUrl(meta) || undefined, meta }),
        })
        escalated.set(`drift:${task.id}`, { level: 'warning', at: now })
        logDryRun('pr_drift', `${task.id} — PR merged ${msToMinutes(driftAge)}m ago, still validating`)
      }
    }
  }

  // ── Auto-merge processing ─────────────────────────────────────────────
  // Attempt to auto-merge green+approved PRs and auto-close tasks
  try {
    const autoMergeResult = processAutoMerge([...validating, ...doingTasks, ...todoTasks])
    if (autoMergeResult.mergeAttempts > 0 || autoMergeResult.autoCloses > 0) {
      logDryRun('auto_merge', `attempts=${autoMergeResult.mergeAttempts} successes=${autoMergeResult.mergeSuccesses} autoCloses=${autoMergeResult.autoCloses} skipped=${autoMergeResult.skipped}`)
    }
  } catch (err) {
    console.error('[Sweeper] Auto-merge processing failed:', err)
    logDryRun('auto_merge_error', String(err))
  }

  const result: SweepResult = {
    timestamp: now,
    violations,
    tasksScanned: totalScanned,
    validatingCount: validating.length,
    autoClosedCount: autoClosedIds.size,
    artifactRejectedCount: artifactRejectedIds.size,
  }

  lastSweepAt = now
  lastSweepResults = result

  logDryRun('sweep_complete', `scanned=${totalScanned} validating=${validating.length} violations=${violations.length}`)

  return result
}

// ── Helper: Extract PR URL from task metadata ──────────────────────────────

function isValidPrUrl(url: string): boolean {
  // Filter out placeholder/invalid PR URLs (e.g. /pull/0, /pull/00)
  const match = url.match(/\/pull\/(\d+)/)
  if (!match) return false
  const prNumber = parseInt(match[1], 10)
  return prNumber > 0
}

function extractPrUrl(meta: Record<string, unknown>): string | null {
  // Skip extraction entirely for doc-only or config-only tasks
  const reviewHandoff = meta.review_handoff as Record<string, unknown> | undefined
  if (reviewHandoff?.doc_only || reviewHandoff?.config_only) return null

  // Check multiple locations where PR URLs are stored
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

  // Return first valid PR URL, filtering out placeholders like /pull/0
  for (const url of candidates) {
    if (isValidPrUrl(url)) return url
  }
  return null
}

// ── Artifact Check ─────────────────────────────────────────────────────────

/**
 * Check if a validating task has required artifacts (PR URL or qa_bundle).
 * Doc-only and config-only tasks are exempt (they use review_handoff).
 */
export function hasRequiredArtifacts(meta: Record<string, unknown>): boolean {
  // Doc-only / config-only tasks don't need code artifacts
  const reviewHandoff = meta.review_handoff as Record<string, unknown> | undefined
  if (reviewHandoff?.doc_only || reviewHandoff?.config_only) return true

  // Reconciled tasks (no code delta) are exempt
  if (meta.reconciled === true) return true

  // Check for PR URL in any known location
  if (extractPrUrl(meta)) return true

  // Check for qa_bundle with meaningful evidence (not just review_packet structure)
  const qaBundle = meta.qa_bundle as Record<string, unknown> | undefined
  if (qaBundle) {
    // pr_link in qa_bundle counts as evidence
    if (qaBundle.pr_link && typeof qaBundle.pr_link === 'string' && isValidPrUrl(qaBundle.pr_link)) return true
    // test results or deployment evidence count
    if (qaBundle.test_results || qaBundle.deployment_url) return true
  }

  // Check artifacts array for any meaningful entry
  const artifacts = meta.artifacts as string[] | undefined
  if (artifacts?.some(a => typeof a === 'string' && a.length > 0 && !a.startsWith('duplicate:'))) return true

  return false
}

// ── Escalation ─────────────────────────────────────────────────────────────

async function escalateViolations(violations: SweepViolation[]): Promise<void> {
  if (violations.length === 0) return

  // ── Batch violations into a single summary message ─────────────────
  // Instead of spamming one message per violation, group them by type
  // and post a single digest. Reduces noise from N messages to 1.
  const critical = violations.filter(v => v.type === 'validating_critical')
  const warnings = violations.filter(v => v.type === 'validating_sla')
  const prIssues = violations.filter(v => v.type === 'orphan_pr' || v.type === 'pr_drift')

  const lines: string[] = [`🔍 **Sweeper Digest** — ${violations.length} issue(s) found`]

  if (critical.length > 0) {
    lines.push('')
    lines.push(`🚨 **Critical** (${critical.length}):`)
    for (const v of critical) {
      lines.push(`  • ${v.title} (${v.taskId}) — ${v.age_minutes}m, reviewer: @${v.reviewer || 'unassigned'}`)
    }
  }

  if (warnings.length > 0) {
    lines.push('')
    lines.push(`⚠️ **SLA Warning** (${warnings.length}):`)
    for (const v of warnings) {
      lines.push(`  • ${v.title} (${v.taskId}) — ${v.age_minutes}m, reviewer: @${v.reviewer || 'unassigned'}`)
    }
  }

  if (prIssues.length > 0) {
    lines.push('')
    lines.push(`📦 **PR Issues** (${prIssues.length}):`)
    for (const v of prIssues) {
      lines.push(`  • ${v.title} (${v.taskId}) — ${v.age_minutes}m`)
    }
  }

  try {
    // Use first violation's taskId for preflight; digest is a summary alert
    const firstTaskId = violations[0]?.taskId || 'unknown'
    await sendAlertWithPreflight({
      channel: 'general',
      from: 'sweeper',
      content: lines.join('\n'),
    }, {
      taskId: firstTaskId,
      alertType: 'sweeper_digest',
      agentId: violations[0]?.reviewer || violations[0]?.assignee,
    })
  } catch {
    console.warn(`[Sweeper] Could not post escalation digest`)
  }

  console.log(`[Sweeper] Escalated ${violations.length} violation(s) (batched):`,
    violations.map(v => `${v.type}:${v.taskId}`).join(', '))
}

// ── PR-State Drift Detection (webhook-triggered) ──────────────────────────

/**
 * Check if a task's linked PR has been merged but the task is still in validating.
 * Called externally when PR state changes are detected.
 */
export function flagPrDrift(taskId: string, prState: 'merged' | 'closed'): SweepViolation | null {
  const lookup = taskManager.resolveTaskId(taskId)
  if (!lookup.task) return null

  const task = lookup.task
  if (task.status === 'done') return null // Already done, no drift

  if (prState === 'merged' && task.status === 'validating') {
    logDryRun('pr_drift_webhook', `${taskId} — PR merged while task validating`)
    return {
      taskId: task.id,
      title: task.title,
      assignee: task.assignee,
      reviewer: task.reviewer,
      type: 'pr_drift',
      age_minutes: 0,
      message: `📦 PR merged but task "${task.title}" (${task.id}) still in validating. @${task.reviewer || 'unassigned'} — review or auto-advance. @${task.assignee || 'unassigned'} — confirm status.`,
    }
  }

  if (prState === 'closed' && task.status !== 'blocked') {
    logDryRun('pr_closed_webhook', `${taskId} — PR closed unmerged`)
    return {
      taskId: task.id,
      title: task.title,
      assignee: task.assignee,
      reviewer: task.reviewer,
      type: 'pr_drift',
      age_minutes: 0,
      message: `🔴 PR closed (not merged) for task "${task.title}" (${task.id}). @${task.assignee || 'unassigned'} — task should be blocked or have replacement PR. @${task.reviewer || 'unassigned'} — confirm action.`,
    }
  }

  return null
}

// ── Drift Report ───────────────────────────────────────────────────────────

/**
 * Generate a comprehensive drift report showing all validating tasks,
 * their PR status, and any orphan PRs or state drift.
 */
export function generateDriftReport(): DriftReport {
  const now = Date.now()
  const validating = taskManager.listTasks({ status: 'validating' })

  const validatingEntries: DriftReportEntry[] = []
  const orphanEntries: DriftReportEntry[] = []

  let staleCount = 0
  let driftCount = 0
  let cleanCount = 0

  // Analyze validating tasks
  for (const task of validating) {
    const meta = (task.metadata || {}) as Record<string, unknown>
    const enteredAt = (meta.entered_validating_at as number) || task.updatedAt
    const lastActivity = (meta.review_last_activity_at as number) || enteredAt
    const ageSinceActivity = now - lastActivity
    const ageMinutes = msToMinutes(ageSinceActivity)
    const prUrl = extractPrUrl(meta)
    const prMerged = !!(meta.pr_merged)

    let issue: DriftReportEntry['issue'] = 'clean'
    let detail = 'On track'

    if (prMerged) {
      issue = 'pr_merged_not_closed'
      detail = `PR merged but task still validating (${ageMinutes}m since last activity)`
      driftCount++
    } else if (!prUrl) {
      issue = 'no_pr_linked'
      detail = `No PR URL found in task metadata — cannot verify PR state`
      staleCount++
    } else if (ageSinceActivity >= VALIDATING_CRITICAL_MS) {
      issue = 'stale_validating'
      detail = `${ageMinutes}m without reviewer activity (CRITICAL threshold: ${VALIDATING_CRITICAL_MS / 60_000}m)`
      staleCount++
    } else if (ageSinceActivity >= VALIDATING_SLA_MS) {
      issue = 'stale_validating'
      detail = `${ageMinutes}m without reviewer activity (SLA threshold: ${VALIDATING_SLA_MS / 60_000}m)`
      staleCount++
    } else {
      cleanCount++
    }

    validatingEntries.push({
      taskId: task.id,
      title: task.title,
      status: task.status,
      assignee: task.assignee,
      reviewer: task.reviewer,
      age_minutes: ageMinutes,
      prUrl: prUrl || undefined,
      prMerged,
      issue,
      detail,
      remediation: issue !== 'clean' ? generateRemediation({ taskId: task.id, issue, prUrl: prUrl || undefined, meta }) : undefined,
    })
  }

  // Collect all PR URLs from all tasks to find orphans
  // Query only statuses that matter for orphan detection
  const driftDone = taskManager.listTasks({ status: 'done' })
  const driftDoing = taskManager.listTasks({ status: 'doing' })
  const driftTodo = taskManager.listTasks({ status: 'todo' })
  const driftBlocked = taskManager.listTasks({ status: 'blocked' })
  const driftAll = [...validating, ...driftDone, ...driftDoing, ...driftTodo, ...driftBlocked]

  const prToTasks = new Map<string, { taskId: string; status: string }[]>()
  for (const task of driftAll) {
    const meta = (task.metadata || {}) as Record<string, unknown>
    const prUrl = extractPrUrl(meta)
    if (!prUrl || prUrl.includes('workspace://')) continue
    if (!prToTasks.has(prUrl)) prToTasks.set(prUrl, [])
    prToTasks.get(prUrl)!.push({ taskId: task.id, status: task.status })
  }

  // Find orphan PRs: PR URLs only linked to done/cancelled tasks (not merged)
  for (const [prUrl, tasks] of prToTasks) {
    const hasActiveTask = tasks.some(t => ['doing', 'validating', 'todo', 'blocked'].includes(t.status))
    if (hasActiveTask) continue

    const doneTasks = tasks.filter(t => t.status === 'done' || t.status === 'cancelled')
    if (doneTasks.length === 0) continue

    // Check if any of the done tasks have pr_merged or reviewer_approved — if so, verify live
    const anyMergedMeta = doneTasks.some(t => {
      const task = driftAll.find(at => at.id === t.taskId)
      if (!task) return false
      const m = (task.metadata || {}) as Record<string, unknown>
      return !!(m.pr_merged)
    })
    if (anyMergedMeta) continue

    // NOTE: Live PR checks removed — execSync blocks event loop.
    // Rely on metadata flags; checkLivePrState() kept for on-demand use only.

    const oldestDone = driftAll.find(t => t.id === doneTasks[0].taskId)
    orphanEntries.push({
      taskId: doneTasks[0].taskId,
      title: oldestDone?.title || 'Unknown',
      status: 'done',
      assignee: oldestDone?.assignee,
      reviewer: oldestDone?.reviewer,
      age_minutes: oldestDone ? msToMinutes(now - oldestDone.updatedAt) : 0,
      prUrl,
      issue: 'orphan_pr',
      detail: `PR linked to ${doneTasks.length} done task(s) but not marked as merged. May still be open.`,
      remediation: generateRemediation({ taskId: doneTasks[0].taskId, issue: 'orphan_pr', prUrl }),
    })
  }

  return {
    timestamp: now,
    validating: validatingEntries,
    orphanPRs: orphanEntries,
    summary: {
      totalValidating: validating.length,
      staleValidating: staleCount,
      orphanPRCount: orphanEntries.length,
      prDriftCount: driftCount,
      cleanCount,
    },
  }
}

// ── Periodic Runner ────────────────────────────────────────────────────────

let sweepTimer: ReturnType<typeof setInterval> | null = null

export function startSweeper(): void {
  if (sweepTimer) return

  console.log(`[Sweeper] Starting execution sweeper (interval: ${SWEEP_INTERVAL_MS / 1000}s, SLA: ${VALIDATING_SLA_MS / 60_000}m, critical: ${VALIDATING_CRITICAL_MS / 60_000}m)`)

  // Defer initial sweep to avoid blocking server startup
  setTimeout(() => {
    ;(async () => {
      const initial = await sweepValidatingQueue()
      escalateViolations(initial.violations)
    })().catch(err => {
      console.error('[Sweeper] Initial sweep failed:', err)
    })
  }, 5000)
  logDryRun('sweeper_started', `interval=${SWEEP_INTERVAL_MS / 1000}s SLA=${VALIDATING_SLA_MS / 60_000}m critical=${VALIDATING_CRITICAL_MS / 60_000}m`)

  sweepTimer = setInterval(() => {
    ;(async () => {
      const result = await sweepValidatingQueue()
      escalateViolations(result.violations)
    })().catch(err => {
      console.error('[Sweeper] Sweep failed:', err)
      logDryRun('sweep_error', String(err))
    })
  }, SWEEP_INTERVAL_MS)

  sweepTimer.unref()
}

export function stopSweeper(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
    logDryRun('sweeper_stopped', 'Manual stop')
  }
}

export function getSweeperStatus(): {
  running: boolean
  lastSweepAt: number
  lastResults: SweepResult | null
  escalationTracking: Array<{ taskId: string; level: string; at: number }>
  dryRunLog: typeof dryRunLog
} {
  return {
    running: sweepTimer !== null,
    lastSweepAt,
    lastResults: lastSweepResults,
    escalationTracking: Array.from(escalated.entries()).map(([taskId, e]) => ({
      taskId,
      level: e.level,
      at: e.at,
    })),
    dryRunLog,
  }
}
