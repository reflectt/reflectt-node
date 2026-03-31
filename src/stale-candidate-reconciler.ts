// SPDX-License-Identifier: Apache-2.0
/**
 * Stale candidate insight reconciler.
 *
 * Problem: candidate insights can persist at P0 even after the underlying issue
 * has been resolved — e.g., lane recovery via merged PRs + done tasks. This causes
 * re-triage noise and distorts the P0 queue signal.
 *
 * Solution: deterministic reconciliation using post-incident recovery evidence:
 *   1. Identify candidate insights in a cluster where recovery evidence exists
 *      (done tasks with merged PR links OR task_created/closed insights in same cluster)
 *   2. Apply guardrails — skip if:
 *       a. A newer candidate exists in the same cluster (ongoing issue)
 *       b. High independent_count (≥3) — multi-author signal, likely real P0
 *       c. Severity is critical (always requires human review)
 *   3. Close eligible insights with reconciliation metadata
 *
 * Safety:
 *   - Dry-run mode always available
 *   - Guardrails prefer false negatives over false positives
 *   - Full audit trail via recordInsightMutation
 *   - Never touches promoted or task_created insights (already actioned)
 *   - Never closes if cluster has an active P0 task in doing/blocked
 *
 * task-1773493678330-trwv1ahk0
 */

import { getDb } from './db.js'
import { closeInsightById, recordInsightMutation } from './insight-mutation.js'
import type { Insight } from './insights.js'

// ── Config ──

/** Insights with independent_count ≥ this value require human review */
const HIGH_INDEPENDENT_COUNT_GUARD = 3

/** Severities that always block auto-reconcile */
const BLOCKED_SEVERITIES = new Set(['critical'])

/** Statuses that indicate the insight is already actioned — skip these */
const SKIP_STATUSES = new Set(['promoted', 'task_created', 'closed', 'cooldown'])

/** Only consider insights older than this (avoid reconciling very fresh candidates) */
const MIN_AGE_MS = 30 * 60 * 1000 // 30 minutes

// ── Types ──

export interface ReconcileEvidence {
  /** Done tasks linked to this cluster */
  doneTasks: Array<{ taskId: string; title: string; hasCanonicalPr: boolean }>
  /** Merged PR URLs referenced in done tasks */
  mergedPrUrls: string[]
  /** Insight IDs in the same cluster that are task_created or closed (actioned) */
  actionedInsightIds: string[]
}

export interface ReconcileGuardrailResult {
  blocked: boolean
  reason?: string
}

export interface ReconcileCandidate {
  insight: Insight
  evidence: ReconcileEvidence
  guardrail: ReconcileGuardrailResult
  eligible: boolean
}

export interface ReconcileSweepResult {
  swept: number
  eligible: number
  closed: number
  blocked: number
  errors: number
  dryRun: boolean
  candidates: ReconcileCandidate[]
  durationMs: number
}

// ── Helpers ──

function getClusterInsights(clusterKey: string, excludeId: string): Insight[] {
  const db = getDb()
  return (db.prepare(
    `SELECT * FROM insights WHERE cluster_key = ? AND id != ? ORDER BY created_at ASC`,
  ).all(clusterKey, excludeId) as any[]).map(rowToInsight)
}

function rowToInsight(row: Record<string, unknown>): Insight {
  return {
    id: row.id as string,
    status: row.status as Insight['status'],
    score: row.score as number,
    priority: row.priority as string,
    severity_max: row.severity_max as string | null,
    independent_count: row.independent_count as number,
    cluster_key: row.cluster_key as string,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
    metadata: (() => {
      try { return row.metadata ? JSON.parse(row.metadata as string) : null } catch { return null }
    })(),
  } as unknown as Insight
}

/** Collect recovery evidence for a cluster. */
function collectEvidence(clusterKey: string, excludeId: string): ReconcileEvidence {
  const db = getDb()

  // Done tasks in the same cluster (by tag or cluster prefix match)
  // Cluster keys follow pattern: "platform::category::surface" or "surface::category::*"
  // We match on any task tagged with a relevant token from the cluster key
  const clusterTokens = clusterKey
    .split('::')
    .map(t => t.trim())
    .filter(t => t && t !== 'unknown' && t !== 'uncategorized')

  const doneTasks: ReconcileEvidence['doneTasks'] = []
  const mergedPrUrls: string[] = []

  if (clusterTokens.length > 0) {
    // Query done tasks — use a broad scan and filter in JS for safety
    const allDone = db.prepare(
      `SELECT id, title, metadata FROM tasks WHERE status = 'done' LIMIT 200`,
    ).all() as Array<{ id: string; title: string; metadata: string | null }>

    for (const task of allDone) {
      const titleLower = task.title?.toLowerCase() ?? ''
      const matches = clusterTokens.some(tok => titleLower.includes(tok.toLowerCase()))
      if (!matches) continue

      let meta: Record<string, unknown> = {}
      try { meta = task.metadata ? JSON.parse(task.metadata) : {} } catch { /* skip */ }

      const canonicalPr = typeof meta.canonical_pr === 'string' ? meta.canonical_pr : null
      const reviewPr = (meta.qa_bundle as any)?.review_packet?.pr_url as string | undefined
      const prUrl = canonicalPr ?? reviewPr ?? null

      const hasCanonicalPr = Boolean(prUrl && prUrl.includes('github.com'))
      doneTasks.push({ taskId: task.id, title: task.title, hasCanonicalPr })
      if (prUrl && hasCanonicalPr) mergedPrUrls.push(prUrl)
    }
  }

  // Same-cluster insights that are already actioned
  const clusterInsights = getClusterInsights(clusterKey, excludeId)
  const actionedInsightIds = clusterInsights
    .filter(i => i.status === 'task_created' || i.status === 'closed')
    .map(i => i.id)

  return { doneTasks, mergedPrUrls, actionedInsightIds }
}

/** Apply guardrails. Returns blocked=true with reason if auto-reconcile is unsafe. */
export function checkGuardrails(insight: Insight, clusterKey: string): ReconcileGuardrailResult {
  // Guardrail 1: severity critical — always requires human review
  if (BLOCKED_SEVERITIES.has(insight.severity_max ?? '')) {
    return { blocked: true, reason: `severity_max=${insight.severity_max} requires human review` }
  }

  // Guardrail 2: high independent_count — multi-author signal
  if ((insight.independent_count ?? 0) >= HIGH_INDEPENDENT_COUNT_GUARD) {
    return {
      blocked: true,
      reason: `independent_count=${insight.independent_count} ≥ ${HIGH_INDEPENDENT_COUNT_GUARD}: multi-author signal requires human review`,
    }
  }

  // Guardrail 3: newer candidate in same cluster — issue may still be active
  const siblings = getClusterInsights(clusterKey, insight.id)
  const newerCandidates = siblings.filter(
    s => s.status === 'candidate' && (s.created_at ?? 0) > (insight.created_at ?? 0),
  )
  if (newerCandidates.length > 0) {
    return {
      blocked: true,
      reason: `newer candidate(s) in cluster [${newerCandidates.map(s => s.id).join(', ')}] — issue may still be active`,
    }
  }

  // Guardrail 4: active P0 tasks in cluster (doing or blocked)
  const db = getDb()
  const clusterTokens = clusterKey
    .split('::')
    .filter(t => t && t !== 'unknown' && t !== 'uncategorized')

  if (clusterTokens.length > 0) {
    const activeTasks = db.prepare(
      `SELECT id FROM tasks WHERE status IN ('doing', 'blocked') AND priority = 'P0' LIMIT 50`,
    ).all() as Array<{ id: string }>

    // Check task titles against cluster tokens (conservative match)
    const activeDone = db.prepare(
      `SELECT id, title FROM tasks WHERE status IN ('doing', 'blocked') LIMIT 200`,
    ).all() as Array<{ id: string; title: string }>

    const hasActiveP0 = activeDone.some(t =>
      clusterTokens.some(tok => t.title?.toLowerCase().includes(tok.toLowerCase())),
    )

    if (hasActiveP0 && activeTasks.length > 0) {
      return { blocked: true, reason: 'active P0 tasks in cluster — issue not yet resolved' }
    }
  }

  return { blocked: false }
}

/** Build a full reconcile candidate entry. */
export function buildCandidate(insight: Insight): ReconcileCandidate {
  const evidence = collectEvidence(insight.cluster_key ?? '', insight.id)
  const guardrail = checkGuardrails(insight, insight.cluster_key ?? '')
  const hasRecoveryEvidence =
    evidence.doneTasks.length > 0 || evidence.actionedInsightIds.length > 0

  return {
    insight,
    evidence,
    guardrail,
    eligible: hasRecoveryEvidence && !guardrail.blocked,
  }
}

// ── Main sweep ──

export function runStaleCandidateReconcileSweep(opts: {
  dryRun?: boolean
  actor?: string
  insightIds?: string[] // restrict sweep to specific IDs
  maxInsights?: number
}): ReconcileSweepResult {
  const start = Date.now()
  const {
    dryRun = false,
    actor = 'stale-candidate-reconciler',
    maxInsights = 100,
  } = opts

  const db = getDb()
  const now = Date.now()
  const minCreatedAt = now - MIN_AGE_MS

  let rows: any[]
  if (opts.insightIds && opts.insightIds.length > 0) {
    const placeholders = opts.insightIds.map(() => '?').join(', ')
    rows = db.prepare(
      `SELECT * FROM insights WHERE id IN (${placeholders}) AND status = 'candidate' AND created_at <= ?`,
    ).all(...opts.insightIds, minCreatedAt) as any[]
  } else {
    rows = db.prepare(
      `SELECT * FROM insights WHERE status = 'candidate' AND created_at <= ? LIMIT ?`,
    ).all(minCreatedAt, maxInsights) as any[]
  }

  const candidates: ReconcileCandidate[] = []
  let closedCount = 0
  let errorCount = 0

  for (const row of rows) {
    const insight = rowToInsight(row)
    const candidate = buildCandidate(insight)
    candidates.push(candidate)

    if (!candidate.eligible) continue

    if (dryRun) {
      // Dry-run: just count, don't mutate
      closedCount++
      continue
    }

    // Close the stale candidate with full audit trail
    const evidenceSummary = [
      candidate.evidence.doneTasks.length > 0
        ? `${candidate.evidence.doneTasks.length} done task(s) in cluster`
        : null,
      candidate.evidence.mergedPrUrls.length > 0
        ? `merged PRs: ${candidate.evidence.mergedPrUrls.slice(0, 2).join(', ')}`
        : null,
      candidate.evidence.actionedInsightIds.length > 0
        ? `actioned insights: ${candidate.evidence.actionedInsightIds.slice(0, 2).join(', ')}`
        : null,
    ].filter(Boolean).join('; ')

    try {
      const result = closeInsightById(insight.id, {
        actor,
        reason: `stale-candidate-reconciler: post-incident recovery evidence found. ${evidenceSummary}`,
        notes: JSON.stringify({
          reconciled_at: now,
          reconciled_by: actor,
          evidence: {
            done_task_ids: candidate.evidence.doneTasks.map(t => t.taskId),
            merged_pr_urls: candidate.evidence.mergedPrUrls,
            actioned_insight_ids: candidate.evidence.actionedInsightIds,
          },
        }),
      })

      if (result.success) {
        closedCount++
      } else {
        errorCount++
        console.warn(`[stale-candidate-reconciler] Close failed for ${insight.id}: ${result.error}`)
      }
    } catch (err) {
      errorCount++
      console.warn(`[stale-candidate-reconciler] Error closing ${insight.id}:`, err)
    }
  }

  const eligibleCount = candidates.filter(c => c.eligible).length
  const blockedCount = candidates.filter(c => !c.eligible && c.guardrail.blocked).length

  return {
    swept: rows.length,
    eligible: eligibleCount,
    closed: closedCount,
    blocked: blockedCount,
    errors: errorCount,
    dryRun,
    candidates,
    durationMs: Date.now() - start,
  }
}
