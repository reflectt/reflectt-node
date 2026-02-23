// SPDX-License-Identifier: Apache-2.0
// Insight→Task Bridge: listens for insight:promoted events and creates tasks.
//
// Severity-aware routing:
//   - high/critical → auto-create task immediately
//   - medium/low → set insight to pending_triage (manual review required)
//
// Design decisions (locked by kai + sage):
//   - Soft guardrail: prefer non-author assignee; if author is best, require non-author reviewer
//   - Required linkage: task.metadata.insight_id + insight.task_id
//   - Idempotency: one task per insight (check insight.task_id before creating)

import { eventBus, type Event } from './events.js'
import { getInsight, updateInsightStatus, type Insight } from './insights.js'
import { taskManager } from './tasks.js'
import { getDb } from './db.js'
import { suggestAssignee, suggestReviewer, getAgentRoles } from './assignment.js'

// ── Types ──

export interface OwnershipGuardrailConfig {
  /** When true, avoid assigning auto-created tasks to sole insight author */
  enabled: boolean
  /** When sole author IS assigned (no alternatives), require non-author reviewer */
  requireNonAuthorReviewer: boolean
  /** Override: teams can disable the guardrail entirely */
  teamOverrides?: Record<string, boolean>
}

export interface AssignmentDecision {
  assignee: string
  reviewer: string
  /** Why this assignment was chosen */
  reason: string
  /** Whether the guardrail fired */
  guardrailApplied: boolean
  /** Whether sole-author fallback was used (guardrail wanted to avoid but couldn't) */
  soleAuthorFallback: boolean
  /** Candidates considered (for audit) */
  candidatesConsidered: string[]
  /** Authors of the insight */
  insightAuthors: string[]
}

export interface BridgeConfig {
  enabled: boolean
  autoCreateSeverities: string[]
  defaultReviewer: string
  defaultEtaDays: number
  assignableAgents: string[]
  ownershipGuardrail: OwnershipGuardrailConfig
}

export interface BridgeStats {
  tasksAutoCreated: number
  insightsTriaged: number
  duplicatesSkipped: number
  errors: number
  lastEventAt: number | null
}

// ── State ──

const LISTENER_ID = 'insight-task-bridge'

let stats: BridgeStats = {
  tasksAutoCreated: 0,
  insightsTriaged: 0,
  duplicatesSkipped: 0,
  errors: 0,
  lastEventAt: null,
}

let config: BridgeConfig = {
  enabled: true,
  autoCreateSeverities: ['high', 'critical'],
  defaultReviewer: 'sage',
  defaultEtaDays: 3,
  assignableAgents: [],
  ownershipGuardrail: {
    enabled: true,
    requireNonAuthorReviewer: true,
  },
}

/**
 * Update bridge config at runtime (e.g., from policy or API).
 */
export function configureBridge(partial: Partial<BridgeConfig>): void {
  config = { ...config, ...partial }
  if (partial.ownershipGuardrail) {
    config.ownershipGuardrail = { ...config.ownershipGuardrail, ...partial.ownershipGuardrail }
  }
}

// ── Bridge Logic ──

async function handlePromotedInsight(event: Event): Promise<void> {
  const data = event.data as { kind?: string; insightId?: string }
  if (data.kind !== 'insight:promoted' || !data.insightId) return
  if (!config.enabled) return

  stats.lastEventAt = Date.now()

  const insight = getInsight(data.insightId)
  if (!insight) {
    stats.errors++
    console.error(`[InsightTaskBridge] Insight ${data.insightId} not found`)
    return
  }

  // Idempotency: skip if insight already has a linked task
  if (insight.task_id) {
    stats.duplicatesSkipped++
    return
  }

  const severity = insight.severity_max || 'medium'
  const isAutoCreate = config.autoCreateSeverities.includes(severity)

  if (isAutoCreate) {
    await autoCreateTask(insight)
  } else {
    updateInsightStatus(insight.id, 'pending_triage')
    stats.insightsTriaged++
    console.log(`[InsightTaskBridge] Insight ${insight.id} → pending_triage (severity: ${severity})`)
  }
}

async function autoCreateTask(insight: Insight): Promise<void> {
  const title = `[Insight] ${insight.title}`
  const description = buildTaskDescription(insight)
  const decision = resolveAssignment(insight)

  try {
    const task = await taskManager.createTask({
      title,
      description,
      status: 'todo',
      priority: (insight.priority as 'P0' | 'P1' | 'P2' | 'P3') || 'P2',
      assignee: decision.assignee,
      reviewer: decision.reviewer,
      createdBy: 'insight-bridge',
      done_criteria: [
        'Root cause addressed or mitigated',
        `Evidence from insight ${insight.id} validated`,
        'Follow-up reflection submitted confirming fix',
      ],
      metadata: {
        insight_id: insight.id,
        source_insight: insight.id,
        source_reflection: insight.reflection_ids[0] || undefined,
        promotion_reason: insight.promotion_readiness,
        severity: insight.severity_max,
        source: 'insight-task-bridge',
        reflection_count: insight.reflection_ids.length,
        authors: insight.authors,
        assignment_decision: {
          reason: decision.reason,
          guardrail_applied: decision.guardrailApplied,
          sole_author_fallback: decision.soleAuthorFallback,
          candidates_considered: decision.candidatesConsidered,
          insight_authors: decision.insightAuthors,
        },
      },
    })

    updateInsightStatus(insight.id, 'task_created', task.id)
    stats.tasksAutoCreated++
    console.log(`[InsightTaskBridge] Auto-created task ${task.id} from insight ${insight.id} (severity: ${insight.severity_max}, assignee: ${decision.assignee}, guardrail: ${decision.guardrailApplied})`)
  } catch (err) {
    stats.errors++
    console.error(`[InsightTaskBridge] Failed to create task for insight ${insight.id}:`, err)
  }
}

// ── Ownership Guardrail ──

/**
 * Resolve assignee + reviewer with ownership guardrail.
 *
 * Policy:
 * 1. If guardrail enabled and insight has single author:
 *    a. Use suggestAssignee (scoring engine) excluding the author
 *    b. If no non-author candidate available → fallback to author, but require non-author reviewer
 * 2. If multi-author: normal suggestAssignee routing (authors are valid candidates)
 * 3. Decision is fully recorded for audit trail
 */
export function resolveAssignment(insight: Insight, teamId?: string): AssignmentDecision {
  const authors = insight.authors || []
  const guardrail = config.ownershipGuardrail
  const guardrailEnabled = guardrail.enabled &&
    (!teamId || !guardrail.teamOverrides || guardrail.teamOverrides[teamId] !== false)

  const isSingleAuthor = authors.length === 1
  const shouldAvoidAuthor = guardrailEnabled && isSingleAuthor

  // Get all tasks for WIP scoring
  let allTasks: Array<{ status: string; assignee?: string; reviewer?: string; metadata?: Record<string, unknown> }> = []
  try {
    allTasks = taskManager.listTasks()
  } catch { /* scoring works without tasks */ }

  // Get role-based candidates
  const roleNames = getAgentRoles().map(r => r.name)
  const candidates = config.assignableAgents.length > 0 ? config.assignableAgents : roleNames

  // Synthetic task for scoring
  const syntheticTask = {
    title: `[Insight] ${insight.title}`,
    tags: [insight.cluster_key, insight.failure_family].filter(Boolean) as string[],
  }

  let assignee: string
  let reason: string
  let guardrailApplied = false
  let soleAuthorFallback = false

  if (shouldAvoidAuthor) {
    // Score all agents including author for role-fit comparison
    const suggestion = suggestAssignee(syntheticTask, allTasks as any)
    const suggestedAgent = suggestion.suggested
    const authorName = authors[0]
    const scores = suggestion.scores || []

    // Compare author's role-fit score vs best non-author
    const authorScore = scores.find(s => s.agent === authorName)
    const nonAuthorScored = scores
      .filter(s => !authors.includes(s.agent) && s.score > 0 && !s.overCap &&
        (candidates.length === 0 || candidates.includes(s.agent)))
    const bestNonAuthor = nonAuthorScored[0] // Already sorted desc

    // Role-fit bypass: author-exclusion must NOT override when author is best/only fit.
    // Bypass when:
    //   1. No non-author candidates with positive score
    //   2. Author significantly outscores best non-author (>1.5x or >=0.2 gap)
    //   3. Protected domain match on author
    const authorIsBestFit = authorScore && authorScore.score > 0 && (
      !bestNonAuthor ||
      (authorScore.score > bestNonAuthor.score * 1.5) ||
      (authorScore.score - bestNonAuthor.score >= 0.2)
    )
    const isProtectedMatch = suggestion.protectedMatch &&
      suggestion.suggested === authorName

    if (isProtectedMatch) {
      // Protected domain → author IS the correct owner, no guardrail needed
      assignee = authorName
      reason = `author_exclusion_bypassed: protected domain "${suggestion.protectedMatch}" → author "${authorName}" is correct owner`
      guardrailApplied = false
    } else if (authorIsBestFit && !authorScore?.overCap) {
      // Author is best role-fit → allow self-assignment, require non-author reviewer
      assignee = authorName
      const gap = bestNonAuthor
        ? `(author ${authorScore!.score.toFixed(2)} vs best non-author ${bestNonAuthor.agent} ${bestNonAuthor.score.toFixed(2)})`
        : '(no non-author candidates with positive score)'
      reason = `author_exclusion_bypassed: author "${authorName}" is best role-fit ${gap}. Non-author reviewer required.`
      guardrailApplied = true
      soleAuthorFallback = true // Triggers non-author reviewer requirement
    } else if (suggestedAgent && !authors.includes(suggestedAgent) && (candidates.length === 0 || candidates.includes(suggestedAgent))) {
      // Scoring engine picked a viable non-author — use it
      assignee = suggestedAgent
      reason = `author_exclusion_applied: non-author "${suggestedAgent}" selected (sole author "${authorName}" avoided)`
      guardrailApplied = true
    } else if (bestNonAuthor) {
      // Best-scoring non-author
      assignee = bestNonAuthor.agent
      reason = `author_exclusion_applied: best non-author "${bestNonAuthor.agent}" selected (sole author "${authorName}" avoided)`
      guardrailApplied = true
    } else {
      // No non-author available at all — fall back to author
      assignee = authorName
      reason = `author_exclusion_bypassed: no non-author candidates available. "${authorName}" assigned as sole fallback. Non-author reviewer required.`
      guardrailApplied = true
      soleAuthorFallback = true
    }
  } else if (!guardrailEnabled) {
    // Guardrail disabled — use scoring engine normally
    const suggestion = suggestAssignee(syntheticTask, allTasks as any)
    assignee = suggestion.suggested || authors[0] || candidates[0] || 'unassigned'
    reason = `Guardrail disabled. Scoring engine selected "${assignee}".`
  } else {
    // Multi-author — normal routing (authors are valid candidates)
    const suggestion = suggestAssignee(syntheticTask, allTasks as any)
    assignee = suggestion.suggested || authors[0] || candidates[0] || 'unassigned'
    reason = `Multi-author insight (${authors.length} authors). Normal scoring applied, selected "${assignee}".`
  }

  // Resolve reviewer
  const reviewer = resolveReviewer(insight, assignee, authors, soleAuthorFallback)

  return {
    assignee,
    reviewer,
    reason,
    guardrailApplied,
    soleAuthorFallback,
    candidatesConsidered: candidates,
    insightAuthors: authors,
  }
}

/**
 * Pick reviewer, enforcing non-author requirement when sole-author fallback was used.
 */
function resolveReviewer(
  insight: Insight,
  assignee: string,
  authors: string[],
  soleAuthorFallback: boolean,
): string {
  // Use suggestReviewer from assignment engine
  let allTasks: Array<{ status: string; assignee?: string; reviewer?: string; metadata?: Record<string, unknown> }> = []
  try {
    allTasks = taskManager.listTasks()
  } catch { /* ok */ }

  const suggestion = suggestReviewer(
    { title: `[Insight] ${insight.title}`, assignee },
    allTasks as any,
  )

  // If sole-author fallback, reviewer MUST NOT be an author
  if (soleAuthorFallback && config.ownershipGuardrail.requireNonAuthorReviewer) {
    if (suggestion.suggested && !authors.includes(suggestion.suggested)) {
      return suggestion.suggested
    }
    // Find any non-author reviewer from scores
    const nonAuthorReviewer = (suggestion.scores || [])
      .find(s => !authors.includes(s.agent) && s.agent !== assignee)
    if (nonAuthorReviewer) return nonAuthorReviewer.agent
    // Hard fallback: default reviewer if not an author
    if (!authors.includes(config.defaultReviewer) && config.defaultReviewer !== assignee) {
      return config.defaultReviewer
    }
    // Last resort: any agent not the assignee
    const roleNames = getAgentRoles().map(r => r.name)
    const anyone = roleNames.find(r => r !== assignee && !authors.includes(r))
    return anyone || config.defaultReviewer
  }

  return suggestion.suggested || config.defaultReviewer
}

function buildTaskDescription(insight: Insight): string {
  return [
    `Auto-created from promoted insight **${insight.id}**.`,
    '',
    `**Cluster:** ${insight.cluster_key}`,
    `**Severity:** ${insight.severity_max || 'unknown'}`,
    `**Score:** ${insight.score}/10`,
    `**Reflections:** ${insight.reflection_ids.length} (${insight.independent_count} independent)`,
    `**Authors:** ${insight.authors.join(', ')}`,
    '',
    `**Evidence:**`,
    ...insight.evidence_refs.map(e => `- ${e}`),
    '',
    'Investigate root cause, validate evidence, implement fix.',
    'Submit a follow-up reflection when done.',
  ].join('\n')
}

// ── Triage Decision Audit ──

export interface TriageDecision {
  id: string
  insight_id: string
  action: 'approve' | 'dismiss'
  reviewer: string
  rationale: string
  outcome_task_id: string | null
  previous_status: string
  new_status: string
  timestamp: number
}

export function ensureTriageAuditTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS triage_audit (
      id TEXT PRIMARY KEY,
      insight_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      rationale TEXT NOT NULL DEFAULT '',
      outcome_task_id TEXT,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_triage_audit_insight ON triage_audit(insight_id);
    CREATE INDEX IF NOT EXISTS idx_triage_audit_ts ON triage_audit(timestamp);
  `)
}

export function recordTriageDecision(decision: Omit<TriageDecision, 'id'>): TriageDecision {
  ensureTriageAuditTable()
  const db = getDb()
  const id = `triage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  db.prepare(`
    INSERT INTO triage_audit (id, insight_id, action, reviewer, rationale, outcome_task_id, previous_status, new_status, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, decision.insight_id, decision.action, decision.reviewer, decision.rationale, decision.outcome_task_id, decision.previous_status, decision.new_status, decision.timestamp)
  return { id, ...decision }
}

export function getTriageAudit(insightId?: string, limit = 50): TriageDecision[] {
  ensureTriageAuditTable()
  const db = getDb()
  if (insightId) {
    return db.prepare('SELECT * FROM triage_audit WHERE insight_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(insightId, limit) as TriageDecision[]
  }
  return db.prepare('SELECT * FROM triage_audit ORDER BY timestamp DESC LIMIT ?')
    .all(limit) as TriageDecision[]
}

// ── Lifecycle ──

export function startInsightTaskBridge(): void {
  if (!config.enabled) {
    console.log('[InsightTaskBridge] Disabled')
    return
  }
  eventBus.on(LISTENER_ID, handlePromotedInsight)
  console.log('[InsightTaskBridge] Listening for insight:promoted events')

  // Catch-up scan: process any promoted insights that were missed
  // (e.g., emitted before bridge was registered, or async handler failed)
  catchUpPromotedInsights().catch(err =>
    console.error('[InsightTaskBridge] Catch-up scan error:', err)
  )
}

/**
 * Scan for promoted insights without linked tasks and process them.
 * Runs once on bridge startup to close the event-miss gap.
 */
async function catchUpPromotedInsights(): Promise<void> {
  const db = getDb()
  // Find insights that are promoted but never got a task.
  // Check both status=promoted (set by engine) and readiness signals.
  const rows = db.prepare(`
    SELECT * FROM insights
    WHERE task_id IS NULL
      AND (
        status = 'promoted'
        OR promotion_readiness IN ('promoted', 'override', 'ready')
      )
      AND status NOT IN ('closed', 'pending_triage', 'task_created')
    ORDER BY score DESC
  `).all() as any[]

  if (rows.length === 0) return

  console.log(`[InsightTaskBridge] Catch-up: found ${rows.length} promoted insight(s) without tasks`)
  let processed = 0

  for (const row of rows) {
    const insight = getInsight(row.id)
    if (!insight || insight.task_id) continue // re-check after getInsight

    const severity = insight.severity_max || 'medium'
    const isAutoCreate = config.autoCreateSeverities.includes(severity)

    if (isAutoCreate) {
      await autoCreateTask(insight)
      processed++
    } else if (insight.status !== 'pending_triage') {
      updateInsightStatus(insight.id, 'pending_triage')
      stats.insightsTriaged++
      processed++
    }
  }

  if (processed > 0) {
    console.log(`[InsightTaskBridge] Catch-up: processed ${processed} insight(s)`)
  }
}

export function stopInsightTaskBridge(): void {
  eventBus.off(LISTENER_ID)
}

export function getInsightTaskBridgeStats(): BridgeStats {
  return { ...stats }
}

export function _resetBridgeStats(): void {
  stats = { tasksAutoCreated: 0, insightsTriaged: 0, duplicatesSkipped: 0, errors: 0, lastEventAt: null }
}

export function getBridgeConfig(): BridgeConfig {
  return { ...config, ownershipGuardrail: { ...config.ownershipGuardrail } }
}

export { handlePromotedInsight as _handlePromotedInsight }
