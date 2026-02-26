// SPDX-License-Identifier: Apache-2.0
// Minimal admin-only insight mutation helpers (cluster re-key + status close)

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getDb, safeJsonParse, safeJsonStringify } from './db.js'
import { INSIGHT_STATUSES, type Insight, type InsightStatus } from './insights.js'

// ── Audit log ─────────────────────────────────────────────────────────────

const DATA_DIR = process.env.REFLECTT_DATA_DIR || path.join(process.cwd(), 'data')
const AUDIT_FILE = path.join(DATA_DIR, 'insight-mutation-audit.jsonl')

export interface InsightMutationAuditEntry {
  timestamp: number
  insightId: string
  actor: string
  reason: string
  changes: Array<{ field: string; before: unknown; after: unknown }>
  context: string
}

const auditEntries: InsightMutationAuditEntry[] = []
const MAX_IN_MEMORY = 2000

export async function recordInsightMutation(entry: InsightMutationAuditEntry): Promise<void> {
  auditEntries.push(entry)
  if (auditEntries.length > MAX_IN_MEMORY) {
    auditEntries.splice(0, auditEntries.length - MAX_IN_MEMORY)
  }

  // Best-effort append-only JSONL
  try {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf-8')
  } catch (err) {
    // Don't block mutations on audit I/O failure
    console.error('[InsightMutationAudit] Failed to write audit entry:', err)
  }
}

export function getRecentInsightMutationAudits(limit = 50): InsightMutationAuditEntry[] {
  return auditEntries.slice(-Math.max(1, Math.min(limit, 500)))
}

export function _clearInsightMutationAuditLog(): void {
  auditEntries.splice(0, auditEntries.length)
}

// ── Mutation ──────────────────────────────────────────────────────────────

export interface InsightPatchRequest {
  actor: string
  reason: string
  status?: InsightStatus
  cluster_key?: string
  metadata?: {
    notes?: string
    cluster_key_override?: string
  }
}

function parseClusterKeyString(clusterKey: string): { workflow_stage: string; failure_family: string; impacted_unit: string } | null {
  const parts = clusterKey.split('::').map(p => p.trim()).filter(Boolean)
  if (parts.length !== 3) return null
  const [workflow_stage, failure_family, impacted_unit] = parts
  if (!workflow_stage || !failure_family || !impacted_unit) return null
  return { workflow_stage, failure_family, impacted_unit }
}

function diff(before: Insight, after: Insight): Array<{ field: string; before: unknown; after: unknown }> {
  const changes: Array<{ field: string; before: unknown; after: unknown }> = []
  const fields: Array<keyof Insight> = [
    'status',
    'cluster_key',
    'workflow_stage',
    'failure_family',
    'impacted_unit',
    'metadata',
    'updated_at',
  ]
  for (const field of fields) {
    const b = before[field]
    const a = after[field]
    if (JSON.stringify(b) !== JSON.stringify(a)) changes.push({ field: String(field), before: b, after: a })
  }
  return changes
}

export function patchInsightById(insightId: string, patch: InsightPatchRequest): { success: boolean; insight?: Insight; error?: string } {
  const db = getDb()

  if (!patch.actor?.trim()) return { success: false, error: 'actor is required' }
  if (!patch.reason?.trim()) return { success: false, error: 'reason is required' }

  const row = db.prepare('SELECT * FROM insights WHERE id = ?').get(insightId) as any
  if (!row) return { success: false, error: 'Insight not found' }

  // Defer to rowToInsight mapping via getInsight to keep consistent shapes.
  const current = db.prepare('SELECT * FROM insights WHERE id = ?').get(insightId) as any
  const before: Insight = {
    id: current.id,
    cluster_key: current.cluster_key,
    workflow_stage: current.workflow_stage,
    failure_family: current.failure_family,
    impacted_unit: current.impacted_unit,
    title: current.title,
    status: current.status,
    score: current.score,
    priority: current.priority,
    reflection_ids: safeJsonParse<string[]>(current.reflection_ids) ?? [],
    independent_count: current.independent_count,
    evidence_refs: safeJsonParse<string[]>(current.evidence_refs) ?? [],
    authors: safeJsonParse<string[]>(current.authors) ?? [],
    promotion_readiness: current.promotion_readiness,
    recurring_candidate: current.recurring_candidate === 1,
    cooldown_until: current.cooldown_until,
    cooldown_reason: current.cooldown_reason,
    severity_max: current.severity_max,
    task_id: current.task_id ?? null,
    metadata: safeJsonParse<Record<string, unknown>>(current.metadata),
    created_at: current.created_at,
    updated_at: current.updated_at,
  } as unknown as Insight

  // Validate status
  if (patch.status !== undefined) {
    if (!INSIGHT_STATUSES.includes(patch.status as any)) {
      return { success: false, error: `Invalid status. Allowed: ${INSIGHT_STATUSES.join(', ')}` }
    }
  }

  // Validate cluster key
  let parsedKey: { workflow_stage: string; failure_family: string; impacted_unit: string } | null = null
  if (patch.cluster_key !== undefined) {
    parsedKey = parseClusterKeyString(patch.cluster_key)
    if (!parsedKey) return { success: false, error: 'Invalid cluster_key. Expected "stage::family::unit"' }
  }

  // Merge metadata (allowlist only)
  const nextMeta: Record<string, unknown> = { ...(before.metadata ?? {}) }
  if (patch.metadata) {
    if (patch.metadata.notes !== undefined) nextMeta.notes = patch.metadata.notes
    if (patch.metadata.cluster_key_override !== undefined) nextMeta.cluster_key_override = patch.metadata.cluster_key_override
  }

  const now = Date.now()
  const nextStatus = patch.status ?? (before.status as InsightStatus)
  const nextClusterKey = patch.cluster_key ?? before.cluster_key
  const nextWorkflowStage = parsedKey?.workflow_stage ?? before.workflow_stage
  const nextFailureFamily = parsedKey?.failure_family ?? before.failure_family
  const nextImpactedUnit = parsedKey?.impacted_unit ?? before.impacted_unit

  db.prepare(`
    UPDATE insights SET
      status = ?,
      cluster_key = ?,
      workflow_stage = ?,
      failure_family = ?,
      impacted_unit = ?,
      metadata = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    nextStatus,
    nextClusterKey,
    nextWorkflowStage,
    nextFailureFamily,
    nextImpactedUnit,
    safeJsonStringify(nextMeta),
    now,
    insightId,
  )

  const updated = db.prepare('SELECT * FROM insights WHERE id = ?').get(insightId) as any
  const after: Insight = {
    ...before,
    status: updated.status,
    cluster_key: updated.cluster_key,
    workflow_stage: updated.workflow_stage,
    failure_family: updated.failure_family,
    impacted_unit: updated.impacted_unit,
    metadata: safeJsonParse<Record<string, unknown>>(updated.metadata),
    updated_at: updated.updated_at,
  } as unknown as Insight

  void recordInsightMutation({
    timestamp: now,
    insightId,
    actor: patch.actor,
    reason: patch.reason,
    changes: diff(before, after),
    context: 'PATCH /insights/:id',
  })

  return { success: true, insight: after }
}
