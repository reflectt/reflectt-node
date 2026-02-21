// SPDX-License-Identifier: Apache-2.0
// Insight → Task promotion workflow + recurring candidate generation
//
// Converts qualified insights into board tasks with required contract fields.
// Records audit trail and generates recurring candidates per role lane.

import { getDb, safeJsonStringify, safeJsonParse } from './db.js'
import { taskManager } from './tasks.js'
import { getInsight, listInsights } from './insights.js'
import type { Insight } from './insights.js'
import { getAgentRoles, suggestAssignee } from './assignment.js'
import type { AgentRole } from './assignment.js'

// ── Types ──

/** Required contract fields for promoted tasks */
export interface PromotionContract {
  /** Task owner/assignee */
  owner: string
  /** Reviewer for the task */
  reviewer: string
  /** Estimated completion time */
  eta: string
  /** How to verify the fix worked */
  acceptance_check: string
  /** What artifact must be produced as proof */
  artifact_proof_requirement: string
  /** When to check in on progress */
  next_checkpoint_eta: string
}

export interface PromotionInput {
  insight_id: string
  contract: PromotionContract
  /** Override title (defaults to insight title) */
  title?: string
  /** Override description */
  description?: string
  /** Priority override (defaults to insight priority) */
  priority?: 'P0' | 'P1' | 'P2' | 'P3'
  /** Team id */
  team_id?: string
}

export interface PromotionResult {
  success: boolean
  task_id?: string
  insight_id: string
  audit_id?: string
  error?: string
}

export interface PromotionAudit {
  id: string
  insight_id: string
  task_id: string
  promoted_by: string
  contract: PromotionContract
  insight_snapshot: {
    score: number
    priority: string
    reflection_count: number
    independent_count: number
    severity_max: string | null
    cluster_key: string
  }
  created_at: number
}

export interface RecurringCandidate {
  insight_id: string
  cluster_key: string
  failure_family: string
  impacted_unit: string
  reflection_count: number
  reopened_count: number
  score: number
  priority: string
  severity_max: string | null
  suggested_owner: string | null
  suggested_lane: string | null
  reason: string
}

// ── Validation ──

export interface PromotionValidation {
  valid: boolean
  errors?: string[]
}

export function validatePromotionInput(body: unknown): PromotionValidation {
  const errors: string[] = []

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] }
  }

  const b = body as Record<string, unknown>

  if (typeof b.insight_id !== 'string' || !b.insight_id) {
    errors.push('insight_id is required')
  }

  if (!b.contract || typeof b.contract !== 'object') {
    errors.push('contract object is required')
  } else {
    const c = b.contract as Record<string, unknown>
    const contractFields = ['owner', 'reviewer', 'eta', 'acceptance_check', 'artifact_proof_requirement', 'next_checkpoint_eta'] as const
    for (const field of contractFields) {
      if (typeof c[field] !== 'string' || !(c[field] as string).trim()) {
        errors.push(`contract.${field} is required and must be a non-empty string`)
      }
    }
  }

  if (b.priority !== undefined && !['P0', 'P1', 'P2', 'P3'].includes(b.priority as string)) {
    errors.push('priority must be P0, P1, P2, or P3')
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true }
}

// ── Promotion ──

/**
 * Promote an insight into a board task.
 */
export async function promoteInsight(input: PromotionInput, promotedBy: string): Promise<PromotionResult> {
  const insight = getInsight(input.insight_id)
  if (!insight) {
    return { success: false, insight_id: input.insight_id, error: 'Insight not found' }
  }

  if (insight.status === 'closed') {
    return { success: false, insight_id: input.insight_id, error: 'Cannot promote a closed insight' }
  }

  // Check if already promoted to a task
  const existingAudit = getPromotionAuditByInsight(input.insight_id)
  if (existingAudit) {
    return {
      success: false,
      insight_id: input.insight_id,
      task_id: existingAudit.task_id,
      error: `Insight already promoted to task ${existingAudit.task_id}`,
    }
  }

  const contract = input.contract
  const priority = input.priority ?? (insight.priority as 'P0' | 'P1' | 'P2' | 'P3')

  // Build task description from insight data
  const description = input.description ?? buildTaskDescription(insight, contract)
  const title = input.title ?? `[Insight] ${insight.title}`

  const task = await taskManager.createTask({
    title,
    description,
    status: 'todo',
    assignee: contract.owner,
    reviewer: contract.reviewer,
    done_criteria: [
      contract.acceptance_check,
      `Artifact: ${contract.artifact_proof_requirement}`,
      `Checkpoint: ${contract.next_checkpoint_eta}`,
    ],
    createdBy: promotedBy,
    priority,
    tags: ['insight-promoted', insight.failure_family],
    metadata: {
      source_insight: input.insight_id,
      promotion_contract: contract,
      eta: contract.eta,
      cluster_key: insight.cluster_key,
      severity_max: insight.severity_max,
      reflection_count: insight.reflection_ids.length,
    },
    ...(input.team_id ? { teamId: input.team_id } : {}),
  })

  // Record audit
  const audit = recordPromotionAudit(insight, task.id, promotedBy, contract)

  // Update insight metadata
  const db = getDb()
  db.prepare(`
    UPDATE insights SET
      metadata = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    safeJsonStringify({ promoted_task_id: task.id, promoted_at: Date.now(), promoted_by: promotedBy }),
    Date.now(),
    insight.id,
  )

  // TODO: emit insight:task_promoted event when EventType supports it

  return {
    success: true,
    task_id: task.id,
    insight_id: insight.id,
    audit_id: audit.id,
  }
}

function buildTaskDescription(insight: Insight, contract: PromotionContract): string {
  return [
    `## Origin`,
    `Promoted from insight \`${insight.id}\` (${insight.cluster_key})`,
    ``,
    `**Score:** ${insight.score}/10 | **Priority:** ${insight.priority} | **Severity:** ${insight.severity_max ?? 'unset'}`,
    `**Reflections:** ${insight.reflection_ids.length} from ${insight.independent_count} author(s)`,
    `**Evidence:** ${insight.evidence_refs.join(', ')}`,
    ``,
    `## Problem`,
    insight.title,
    ``,
    `## Contract`,
    `- **Owner:** ${contract.owner}`,
    `- **Reviewer:** ${contract.reviewer}`,
    `- **ETA:** ${contract.eta}`,
    `- **Acceptance:** ${contract.acceptance_check}`,
    `- **Artifact:** ${contract.artifact_proof_requirement}`,
    `- **Checkpoint:** ${contract.next_checkpoint_eta}`,
  ].join('\n')
}

// ── Audit ──

export function ensurePromotionAuditTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS promotion_audits (
      id TEXT PRIMARY KEY,
      insight_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      promoted_by TEXT NOT NULL,
      contract TEXT NOT NULL,          -- JSON
      insight_snapshot TEXT NOT NULL,   -- JSON
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_promotion_audits_insight ON promotion_audits(insight_id);
    CREATE INDEX IF NOT EXISTS idx_promotion_audits_task ON promotion_audits(task_id);
  `)
}

function recordPromotionAudit(insight: Insight, taskId: string, promotedBy: string, contract: PromotionContract): PromotionAudit {
  ensurePromotionAuditTable()
  const db = getDb()
  const id = `paudit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const now = Date.now()

  const snapshot = {
    score: insight.score,
    priority: insight.priority,
    reflection_count: insight.reflection_ids.length,
    independent_count: insight.independent_count,
    severity_max: insight.severity_max,
    cluster_key: insight.cluster_key,
  }

  db.prepare(`
    INSERT INTO promotion_audits (id, insight_id, task_id, promoted_by, contract, insight_snapshot, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, insight.id, taskId, promotedBy, safeJsonStringify(contract), safeJsonStringify(snapshot), now)

  return { id, insight_id: insight.id, task_id: taskId, promoted_by: promotedBy, contract, insight_snapshot: snapshot, created_at: now }
}

export function getPromotionAuditByInsight(insightId: string): PromotionAudit | null {
  ensurePromotionAuditTable()
  const db = getDb()
  const row = db.prepare('SELECT * FROM promotion_audits WHERE insight_id = ? ORDER BY created_at DESC LIMIT 1').get(insightId) as any
  if (!row) return null
  return {
    id: row.id,
    insight_id: row.insight_id,
    task_id: row.task_id,
    promoted_by: row.promoted_by,
    contract: safeJsonParse<PromotionContract>(row.contract)!,
    insight_snapshot: safeJsonParse<PromotionAudit['insight_snapshot']>(row.insight_snapshot)!,
    created_at: row.created_at,
  }
}

export function listPromotionAudits(limit = 50): PromotionAudit[] {
  ensurePromotionAuditTable()
  const db = getDb()
  const rows = db.prepare('SELECT * FROM promotion_audits ORDER BY created_at DESC LIMIT ?').all(limit) as any[]
  return rows.map(row => ({
    id: row.id,
    insight_id: row.insight_id,
    task_id: row.task_id,
    promoted_by: row.promoted_by,
    contract: safeJsonParse<PromotionContract>(row.contract)!,
    insight_snapshot: safeJsonParse<PromotionAudit['insight_snapshot']>(row.insight_snapshot)!,
    created_at: row.created_at,
  }))
}

// ── Recurring candidate generation ──

/**
 * Generate recurring task candidates from insights that show persistent patterns.
 *
 * Criteria:
 *   - recurring_candidate = true (insight was reopened or has 4+ reflections)
 *   - status is promoted or cooldown (active insights)
 *   - Not already promoted to a task
 *
 * Per-lane assignment: maps failure_family + impacted_unit to agent roles.
 */
export function generateRecurringCandidates(): RecurringCandidate[] {
  const db = getDb()
  ensurePromotionAuditTable()

  // Get recurring insights that haven't been promoted to tasks yet
  const rows = db.prepare(`
    SELECT i.* FROM insights i
    LEFT JOIN promotion_audits pa ON pa.insight_id = i.id
    WHERE i.recurring_candidate = 1
      AND i.status IN ('promoted', 'cooldown', 'candidate')
      AND pa.id IS NULL
    ORDER BY i.score DESC
  `).all() as any[]

  const roles = getAgentRoles()
  const candidates: RecurringCandidate[] = []

  for (const row of rows) {
    const reflectionIds = safeJsonParse<string[]>(row.reflection_ids) ?? []
    const suggested = suggestOwnerForInsight(row.failure_family, row.impacted_unit, roles)

    candidates.push({
      insight_id: row.id,
      cluster_key: row.cluster_key,
      failure_family: row.failure_family,
      impacted_unit: row.impacted_unit,
      reflection_count: reflectionIds.length,
      reopened_count: 0, // not tracked in current schema, inferred from recurring_candidate
      score: row.score,
      priority: row.priority,
      severity_max: row.severity_max,
      suggested_owner: suggested.owner,
      suggested_lane: suggested.lane,
      reason: buildRecurringReason(row, reflectionIds.length),
    })
  }

  return candidates
}

function suggestOwnerForInsight(
  failureFamily: string,
  impactedUnit: string,
  roles: AgentRole[],
): { owner: string | null; lane: string | null } {
  // Map failure families to likely role affinities
  const tagHints = [failureFamily, impactedUnit]

  for (const role of roles) {
    const matches = role.affinityTags.some(tag =>
      tagHints.some(hint => hint.toLowerCase().includes(tag.toLowerCase()) || tag.toLowerCase().includes(hint.toLowerCase()))
    )
    if (matches) {
      return { owner: role.name, lane: role.role }
    }
  }

  // Fallback: try suggestAssignee with a synthetic task
  try {
    const suggestion = suggestAssignee({ title: `Fix ${failureFamily} issue in ${impactedUnit}` }, [])
    if (suggestion?.suggested) {
      const matchedRole = roles.find(r => r.name === suggestion.suggested)
      return { owner: suggestion.suggested, lane: matchedRole?.role ?? null }
    }
  } catch {
    // assignment module may not be loaded
  }

  return { owner: null, lane: null }
}

function buildRecurringReason(row: any, reflectionCount: number): string {
  const parts: string[] = []
  if (reflectionCount >= 4) parts.push(`${reflectionCount} reflections filed`)
  if (row.severity_max === 'critical' || row.severity_max === 'high') parts.push(`max severity: ${row.severity_max}`)
  parts.push(`score: ${row.score}/10`)
  return parts.length > 0 ? parts.join(', ') : 'recurring pattern detected'
}

// ── Test helpers ──

export function _clearPromotionAudits(): void {
  try {
    const db = getDb()
    db.prepare('DELETE FROM promotion_audits').run()
  } catch {
    // Table may not exist
  }
}
