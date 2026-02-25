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
const VALIDATING_SLA_MS = 30 * 60 * 1000 // 30 minutes

/** Critical SLA: second escalation tier */
const VALIDATING_CRITICAL_MS = 60 * 60 * 1000 // 60 minutes

/** PR age threshold: flag PRs linked to non-active tasks older than this */
const ORPHAN_PR_THRESHOLD_MS = 2 * 60 * 60 * 1000 // 2 hours

/** Track which tasks we've already escalated (avoid spam) */
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

export function sweepValidatingQueue(): SweepResult {
  const now = Date.now()
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
      try {
        taskManager.updateTask(task.id, {
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

  // Filter out auto-closed tasks from SLA checks
  const remainingValidating = validating.filter(t => !autoClosedIds.has(t.id))

  for (const task of remainingValidating) {
    const meta = (task.metadata || {}) as Record<string, unknown>
    const enteredAt = (meta.entered_validating_at as number) || task.updatedAt
    const lastActivity = (meta.review_last_activity_at as number) || enteredAt
    const ageSinceActivity = now - lastActivity
    const ageMinutes = Math.round(ageSinceActivity / 60_000)

    const prev = escalated.get(task.id)

    if (ageSinceActivity >= VALIDATING_CRITICAL_MS && prev?.level !== 'critical') {
      const prUrl = extractPrUrl(meta)
      violations.push({
        taskId: task.id,
        title: task.title,
        assignee: task.assignee,
        reviewer: task.reviewer,
        type: 'validating_critical',
        age_minutes: ageMinutes,
        message: `🚨 CRITICAL: "${task.title}" (${task.id}) stuck in validating for ${ageMinutes}m. @${task.reviewer || 'unassigned'} please review. @${task.assignee || 'unassigned'} — your PR is blocked.`,
        remediation: generateRemediation({ taskId: task.id, issue: 'stale_validating', prUrl: prUrl || undefined, meta }),
      })
      escalated.set(task.id, { level: 'critical', at: now })
      logDryRun('validating_critical', `${task.id} — ${ageMinutes}m — reviewer:${task.reviewer} assignee:${task.assignee}`)
    } else if (ageSinceActivity >= VALIDATING_SLA_MS && !prev) {
      const prUrl = extractPrUrl(meta)
      violations.push({
        taskId: task.id,
        title: task.title,
        assignee: task.assignee,
        reviewer: task.reviewer,
        type: 'validating_sla',
        age_minutes: ageMinutes,
        message: `⚠️ SLA breach: "${task.title}" (${task.id}) in validating ${ageMinutes}m. @${task.reviewer || 'unassigned'} — review needed. @${task.assignee || 'unassigned'} — ping if blocked.`,
        remediation: generateRemediation({ taskId: task.id, issue: 'stale_validating', prUrl: prUrl || undefined, meta }),
      })
      escalated.set(task.id, { level: 'warning', at: now })
      logDryRun('validating_sla', `${task.id} — ${ageMinutes}m — reviewer:${task.reviewer} assignee:${task.assignee}`)
    }
  }

  // Clean up escalation tracking for tasks no longer validating
  for (const [key] of escalated) {
    // drift: prefix holds the real task ID — strip before resolving
    const realTaskId = key.startsWith("drift:") ? key.slice(6) : key
    const lookup = taskManager.resolveTaskId(realTaskId)
    if (!lookup.task || lookup.task.status !== "validating") {
      escalated.delete(key)
      logDryRun("escalation_cleared", `${key} — no longer validating`)
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
        age_minutes: Math.round(completedAge / 60_000),
        message: `🔍 Orphan PR detected: ${prUrl} linked to done task "${task.title}" (${task.id}). PR may still be open — ${assigneeMention} close or merge it. ${reviewerMention} — confirm status.`,
        remediation: generateRemediation({ taskId: task.id, issue: 'orphan_pr', prUrl }),
      })
      flaggedOrphanPRs.add(prUrl)
      logDryRun('orphan_pr', `${prUrl} on ${task.id} — task done ${Math.round(completedAge / 60_000)}m ago`)
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
          age_minutes: Math.round(driftAge / 60_000),
          message: `📦 PR merged ${Math.round(driftAge / 60_000)}m ago but "${task.title}" (${task.id}) still in validating. @${task.reviewer || 'unassigned'} — approve or close. @${task.assignee || 'unassigned'} — ping if needed.`,
          remediation: generateRemediation({ taskId: task.id, issue: 'pr_merged_not_closed', prUrl: extractPrUrl(meta) || undefined, meta }),
        })
        escalated.set(`drift:${task.id}`, { level: 'warning', at: now })
        logDryRun('pr_drift', `${task.id} — PR merged ${Math.round(driftAge / 60_000)}m ago, still validating`)
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

// ── Escalation ─────────────────────────────────────────────────────────────

async function escalateViolations(violations: SweepViolation[]): Promise<void> {
  if (violations.length === 0) return

  for (const v of violations) {
    // Post to general channel for visibility — includes @mentions for owner + reviewer
    try {
      await chatManager.sendMessage({
        channel: 'general',
        from: 'sweeper',
        content: v.message,
      })
    } catch {
      // Chat might not be ready — log only
      console.warn(`[Sweeper] Could not post escalation for ${v.taskId}`)
    }
  }

  console.log(`[Sweeper] Escalated ${violations.length} violation(s):`,
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
    const ageMinutes = Math.round(ageSinceActivity / 60_000)
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
      age_minutes: oldestDone ? Math.round((now - oldestDone.updatedAt) / 60_000) : 0,
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
    try {
      const initial = sweepValidatingQueue()
      escalateViolations(initial.violations)
    } catch (err) {
      console.error('[Sweeper] Initial sweep failed:', err)
    }
  }, 5000)
  logDryRun('sweeper_started', `interval=${SWEEP_INTERVAL_MS / 1000}s SLA=${VALIDATING_SLA_MS / 60_000}m critical=${VALIDATING_CRITICAL_MS / 60_000}m`)

  sweepTimer = setInterval(() => {
    try {
      const result = sweepValidatingQueue()
      escalateViolations(result.violations)
    } catch (err) {
      console.error('[Sweeper] Sweep failed:', err)
      logDryRun('sweep_error', String(err))
    }
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
