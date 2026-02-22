// SPDX-License-Identifier: Apache-2.0
// Insight clustering + dedupe/cooldown engine
// Clusters reflections → insights with promotion gates and cooldown controls

import { getDb, safeJsonStringify, safeJsonParse } from './db.js'
import { eventBus } from './events.js'
import type { Reflection } from './reflections.js'

// ── Constants ──

const COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24 hours
const PROMOTION_THRESHOLD = 2             // independent reflections needed

export const INSIGHT_STATUSES = ['candidate', 'promoted', 'pending_triage', 'task_created', 'cooldown', 'closed'] as const
export type InsightStatus = (typeof INSIGHT_STATUSES)[number]

export const PROMOTION_READINESS = ['not_ready', 'ready', 'promoted', 'override'] as const
export type PromotionReadiness = (typeof PROMOTION_READINESS)[number]

// ── Types ──

export interface InsightClusterKey {
  workflow_stage: string
  failure_family: string
  impacted_unit: string
}

export interface Insight {
  id: string
  cluster_key: string         // serialized "stage::family::unit"
  workflow_stage: string
  failure_family: string
  impacted_unit: string
  title: string
  status: InsightStatus
  score: number               // 0-10 aggregate
  priority: string            // P0-P3 derived from score
  reflection_ids: string[]
  independent_count: number   // unique authors
  evidence_refs: string[]     // aggregated evidence
  authors: string[]           // unique authors list
  promotion_readiness: PromotionReadiness
  recurring_candidate: boolean
  cooldown_until: number | null
  cooldown_reason: string | null
  severity_max: string | null
  task_id?: string | null      // linked task (set when auto-created or manually promoted)
  metadata?: Record<string, unknown>
  created_at: number
  updated_at: number
}

// ── DB row mapping ──

interface InsightRow {
  id: string
  cluster_key: string
  workflow_stage: string
  failure_family: string
  impacted_unit: string
  title: string
  status: string
  score: number
  priority: string
  reflection_ids: string
  independent_count: number
  evidence_refs: string
  authors: string
  promotion_readiness: string
  recurring_candidate: number
  cooldown_until: number | null
  cooldown_reason: string | null
  severity_max: string | null
  task_id: string | null
  metadata: string | null
  created_at: number
  updated_at: number
}

function rowToInsight(row: InsightRow): Insight {
  return {
    id: row.id,
    cluster_key: row.cluster_key,
    workflow_stage: row.workflow_stage,
    failure_family: row.failure_family,
    impacted_unit: row.impacted_unit,
    title: row.title,
    status: row.status as InsightStatus,
    score: row.score,
    priority: row.priority,
    reflection_ids: safeJsonParse<string[]>(row.reflection_ids) ?? [],
    independent_count: row.independent_count,
    evidence_refs: safeJsonParse<string[]>(row.evidence_refs) ?? [],
    authors: safeJsonParse<string[]>(row.authors) ?? [],
    promotion_readiness: row.promotion_readiness as PromotionReadiness,
    recurring_candidate: row.recurring_candidate === 1,
    cooldown_until: row.cooldown_until,
    cooldown_reason: row.cooldown_reason,
    severity_max: row.severity_max,
    task_id: row.task_id ?? null,
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// ── Helpers ──

function generateId(): string {
  return `ins-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function scoreToPriority(score: number): string {
  if (score >= 8) return 'P0'
  if (score >= 5) return 'P1'
  if (score >= 3) return 'P2'
  return 'P3'
}

function buildClusterKeyString(key: InsightClusterKey): string {
  return `${key.workflow_stage}::${key.failure_family}::${key.impacted_unit}`
}

/**
 * Compute aggregate score from linked reflections.
 * Base = max confidence, +severity boost, +volume boost.
 */
export function computeScore(reflections: Reflection[]): number {
  if (reflections.length === 0) return 0

  const maxConf = Math.max(...reflections.map(r => r.confidence))

  const severityBoost = reflections.reduce((max, r) => {
    if (r.severity === 'critical') return Math.max(max, 2)
    if (r.severity === 'high') return Math.max(max, 1)
    return max
  }, 0)

  const volumeBoost = Math.min((reflections.length - 1) * 0.5, 2)

  return Math.min(10, Math.round((maxConf + severityBoost + volumeBoost) * 10) / 10)
}

function maxSeverity(reflections: Reflection[]): string | null {
  const order = ['low', 'medium', 'high', 'critical']
  let best = -1
  for (const r of reflections) {
    if (r.severity) {
      const idx = order.indexOf(r.severity)
      if (idx > best) best = idx
    }
  }
  return best >= 0 ? order[best] : null
}

/**
 * Build cluster key from a reflection.
 *
 * Extraction priority:
 *   1. Explicit prefixed tags: `stage:X`, `family:Y`, `unit:Z`
 *   2. Inference from pain text + free-form tags (for workflow_stage and failure_family)
 *   3. team_id fallback for impacted_unit
 *   4. 'general' fallback (not 'unknown') for better clustering of untagged reflections
 */
export function extractClusterKey(reflection: Reflection): InsightClusterKey {
  const tags = reflection.tags ?? []

  const explicitStage = tags.find(t => t.startsWith('stage:'))?.slice(6)
  const explicitFamily = tags.find(t => t.startsWith('family:'))?.slice(7)
  const explicitUnit = tags.find(t => t.startsWith('unit:'))?.slice(5)

  return {
    workflow_stage: explicitStage ?? _inferWorkflowStage(reflection.pain, tags) ?? 'general',
    failure_family: explicitFamily ?? _inferFailureFamily(reflection.pain, tags),
    impacted_unit: explicitUnit ?? reflection.team_id ?? _inferUnit(tags) ?? 'general',
  }
}

/**
 * Infer workflow stage from pain text and free-form tags.
 */
function _inferWorkflowStage(pain: string, tags: string[]): string | null {
  const combined = `${pain} ${tags.join(' ')}`.toLowerCase()
  if (/review|pr\b|code.review|approval/i.test(combined)) return 'review'
  if (/deploy|release|ship|prod|staging/i.test(combined)) return 'deploy'
  if (/build|ci\b|pipeline|compile/i.test(combined)) return 'build'
  if (/test|qa\b|coverage|regress/i.test(combined)) return 'test'
  if (/design|spec|plan|architect/i.test(combined)) return 'design'
  if (/implement|code|develop|feature|refactor/i.test(combined)) return 'implement'
  if (/triage|intake|assign|priorit/i.test(combined)) return 'triage'
  if (/process|workflow|discipline|drift|handoff/i.test(combined)) return 'process'
  if (/discover|find|exist|duplicate|redundant/i.test(combined)) return 'discovery'
  return null
}

function _inferFailureFamily(pain: string, tags?: string[]): string {
  const combined = tags ? `${pain} ${tags.join(' ')}`.toLowerCase() : pain.toLowerCase()
  if (/truncat|cut.?off|missing.?text|incomplete/i.test(combined)) return 'data-loss'
  if (/crash|exception|error|fail/i.test(combined)) return 'runtime-error'
  if (/slow|timeout|latency|performance/i.test(combined)) return 'performance'
  if (/auth|permission|denied|forbidden/i.test(combined)) return 'access'
  if (/ui|display|render|layout|style/i.test(combined)) return 'ui'
  if (/config|setting|env/i.test(combined)) return 'config'
  if (/deploy|release|build|ci\b/i.test(combined)) return 'deployment'
  if (/test|coverage|flak/i.test(combined)) return 'testing'
  if (/duplicate|redundant|discover|existing.*code/i.test(combined)) return 'code-discovery'
  if (/process|discipline|drift|handoff|schema|template/i.test(combined)) return 'process'
  if (/pr\b|merge|branch|commit|push/i.test(combined)) return 'pr-workflow'
  return 'uncategorized'
}

/**
 * Try to infer impacted unit from free-form tags.
 */
function _inferUnit(tags: string[]): string | null {
  // Common unit-like tags
  const unitLike = tags.find(t =>
    /^(api|frontend|backend|infra|ci|ux|docs|node|cloud|cli)$/i.test(t)
  )
  return unitLike?.toLowerCase() ?? null
}

// ── Promotion gate ──

/**
 * Minimum content quality check for a reflection.
 * Prevents synthetic/test reflections with sparse content from triggering
 * promotion. Each key field must have at least MIN_FIELD_LENGTH chars
 * and at least MIN_QUALITY_FIELDS fields must pass.
 */
const MIN_FIELD_LENGTH = 10
const MIN_QUALITY_FIELDS = 3

export function hasMinimumQuality(reflection: Reflection): boolean {
  const fields = [reflection.pain, reflection.impact, reflection.suspected_why, reflection.proposed_fix]
  const qualifyingFields = fields.filter(f => f && f.trim().length >= MIN_FIELD_LENGTH)
  return qualifyingFields.length >= MIN_QUALITY_FIELDS
}

/**
 * Can this set of reflections promote an insight?
 *
 * Rules:
 *   0. At least one reflection must pass minimum quality gate
 *   1. >= 2 independent reflections (different authors)
 *   2. OR 1 high/critical-severity reflection with evidence (override)
 */
export function canPromote(reflections: Reflection[]): boolean {
  // Quality gate: at least one substantive reflection required
  const hasQualityReflection = reflections.some(hasMinimumQuality)
  if (!hasQualityReflection) return false

  // High-severity override (only from quality reflections)
  const hasHighSeverityWithEvidence = reflections.some(
    r => (r.severity === 'high' || r.severity === 'critical') && r.evidence.length > 0 && hasMinimumQuality(r)
  )
  if (hasHighSeverityWithEvidence) return true

  // Standard: 2 independent authors (at least one quality)
  const uniqueAuthors = new Set(reflections.map(r => r.author))
  return uniqueAuthors.size >= PROMOTION_THRESHOLD
}

// ── Core engine ──

/**
 * Find existing active insight matching a cluster key.
 */
export function findByCluster(clusterKeyStr: string): Insight | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT * FROM insights
    WHERE cluster_key = ? AND status != 'closed'
    ORDER BY created_at DESC LIMIT 1
  `).get(clusterKeyStr) as InsightRow | undefined
  return row ? rowToInsight(row) : null
}

/**
 * Ingest a reflection into the insight engine.
 */
export function ingestReflection(reflection: Reflection): Insight {
  const db = getDb()
  const now = Date.now()
  const clusterKey = extractClusterKey(reflection)
  const clusterKeyStr = buildClusterKeyString(clusterKey)

  let existing = findByCluster(clusterKeyStr)

  if (existing) {
    // Cooldown: if in cooldown and new reflection arrives, reopen
    if (existing.status === 'cooldown') {
      if (existing.cooldown_until && now < existing.cooldown_until) {
        return reopenInsight(existing, reflection)
      }
      // Cooldown expired → close and create fresh
      db.prepare('UPDATE insights SET status = ?, updated_at = ? WHERE id = ?')
        .run('closed', now, existing.id)
      existing = null
    }
  }

  if (existing) {
    return addReflectionToInsight(existing, reflection)
  }

  return createInsight(clusterKey, clusterKeyStr, reflection)
}

function createInsight(key: InsightClusterKey, clusterKeyStr: string, reflection: Reflection): Insight {
  const db = getDb()
  const now = Date.now()
  const id = generateId()

  const reflections = [reflection]
  const score = computeScore(reflections)
  const priority = scoreToPriority(score)
  const authors = [reflection.author]
  const evidenceRefs = [...reflection.evidence]
  const shouldPromote = canPromote(reflections)

  const status: InsightStatus = shouldPromote ? 'promoted' : 'candidate'
  const readiness: PromotionReadiness = shouldPromote
    ? (reflection.severity === 'high' || reflection.severity === 'critical' ? 'override' : 'promoted')
    : 'not_ready'
  const cooldownUntil = shouldPromote ? now + COOLDOWN_MS : null
  const cooldownReason = shouldPromote ? 'auto-promoted' : null
  const sevMax = maxSeverity(reflections)

  const title = `${key.failure_family}: ${reflection.pain.slice(0, 80)}`

  const insight: Insight = {
    id,
    cluster_key: clusterKeyStr,
    workflow_stage: key.workflow_stage,
    failure_family: key.failure_family,
    impacted_unit: key.impacted_unit,
    title,
    status,
    score,
    priority,
    reflection_ids: [reflection.id],
    independent_count: 1,
    evidence_refs: evidenceRefs,
    authors,
    promotion_readiness: readiness,
    recurring_candidate: false,
    cooldown_until: cooldownUntil,
    cooldown_reason: cooldownReason,
    severity_max: sevMax,
    created_at: now,
    updated_at: now,
  }

  db.prepare(`
    INSERT INTO insights (
      id, cluster_key, workflow_stage, failure_family, impacted_unit,
      title, status, score, priority, reflection_ids, independent_count,
      evidence_refs, authors, promotion_readiness, recurring_candidate,
      cooldown_until, cooldown_reason, severity_max, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, clusterKeyStr, key.workflow_stage, key.failure_family, key.impacted_unit,
    title, status, score, priority,
    safeJsonStringify(insight.reflection_ids),
    1,
    safeJsonStringify(evidenceRefs),
    safeJsonStringify(authors),
    readiness, 0,
    cooldownUntil, cooldownReason, sevMax,
    now, now,
  )

  if (shouldPromote) {
    eventBus.emit({
      id: `evt-insight-promoted-${id}`,
      type: 'task_created' as const,
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: id, priority, score },
    })
  } else {
    eventBus.emit({
      id: `evt-insight-created-${id}`,
      type: 'task_created' as const,
      timestamp: Date.now(),
      data: { kind: 'insight:created', insightId: id },
    })
  }

  return insight
}

function addReflectionToInsight(existing: Insight, reflection: Reflection): Insight {
  const db = getDb()
  const now = Date.now()

  // Dedupe
  if (existing.reflection_ids.includes(reflection.id)) return existing

  const updatedIds = [...existing.reflection_ids, reflection.id]
  const updatedAuthors = [...new Set([...existing.authors, reflection.author])]
  const updatedEvidence = [...new Set([...existing.evidence_refs, ...reflection.evidence])]

  const allReflections = loadReflectionsById(updatedIds)
  const score = computeScore(allReflections)
  const priority = scoreToPriority(score)
  const sevMax = maxSeverity(allReflections)

  const wasCandidate = existing.status === 'candidate'
  const shouldPromote = wasCandidate && canPromote(allReflections)

  const status: InsightStatus = shouldPromote ? 'promoted' : existing.status
  const readiness: PromotionReadiness = shouldPromote
    ? (updatedAuthors.length >= PROMOTION_THRESHOLD ? 'promoted' : 'override')
    : (canPromote(allReflections) ? 'ready' : existing.promotion_readiness)
  const cooldownUntil = shouldPromote ? now + COOLDOWN_MS : existing.cooldown_until
  const cooldownReason = shouldPromote ? 'auto-promoted' : existing.cooldown_reason

  // Recurring if reopened or has many reflections
  const recurring = updatedIds.length >= 4

  db.prepare(`
    UPDATE insights SET
      reflection_ids = ?, independent_count = ?, evidence_refs = ?,
      authors = ?, score = ?, priority = ?, status = ?,
      promotion_readiness = ?, recurring_candidate = ?,
      cooldown_until = ?, cooldown_reason = ?, severity_max = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    safeJsonStringify(updatedIds),
    updatedAuthors.length,
    safeJsonStringify(updatedEvidence),
    safeJsonStringify(updatedAuthors),
    score, priority, status,
    readiness, recurring ? 1 : 0,
    cooldownUntil, cooldownReason, sevMax,
    now,
    existing.id,
  )

  if (shouldPromote && wasCandidate) {
    eventBus.emit({
      id: `evt-insight-promoted-${existing.id}`,
      type: 'task_created' as const,
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: existing.id, priority, score },
    })
  }

  return {
    ...existing,
    reflection_ids: updatedIds,
    independent_count: updatedAuthors.length,
    evidence_refs: updatedEvidence,
    authors: updatedAuthors,
    score,
    priority,
    status,
    promotion_readiness: readiness,
    recurring_candidate: recurring,
    cooldown_until: cooldownUntil,
    cooldown_reason: cooldownReason,
    severity_max: sevMax,
    updated_at: now,
  }
}

function reopenInsight(existing: Insight, reflection: Reflection): Insight {
  const db = getDb()
  const now = Date.now()

  const updatedIds = existing.reflection_ids.includes(reflection.id)
    ? existing.reflection_ids
    : [...existing.reflection_ids, reflection.id]
  const updatedAuthors = [...new Set([...existing.authors, reflection.author])]
  const updatedEvidence = [...new Set([...existing.evidence_refs, ...reflection.evidence])]

  const allReflections = loadReflectionsById(updatedIds)
  const score = computeScore(allReflections)
  const priority = scoreToPriority(score)
  const sevMax = maxSeverity(allReflections)

  db.prepare(`
    UPDATE insights SET
      status = 'promoted', reflection_ids = ?, independent_count = ?,
      evidence_refs = ?, authors = ?, score = ?, priority = ?,
      promotion_readiness = 'promoted', recurring_candidate = 1,
      cooldown_until = ?, cooldown_reason = 'reopened',
      severity_max = ?, updated_at = ?
    WHERE id = ?
  `).run(
    safeJsonStringify(updatedIds),
    updatedAuthors.length,
    safeJsonStringify(updatedEvidence),
    safeJsonStringify(updatedAuthors),
    score, priority,
    now + COOLDOWN_MS,
    sevMax, now,
    existing.id,
  )

  eventBus.emit({
    id: `evt-insight-reopened-${existing.id}`,
    type: 'task_updated' as const,
    timestamp: Date.now(),
    data: { kind: 'insight:reopened', insightId: existing.id },
  })

  return {
    ...existing,
    status: 'promoted',
    reflection_ids: updatedIds,
    independent_count: updatedAuthors.length,
    evidence_refs: updatedEvidence,
    authors: updatedAuthors,
    score,
    priority,
    promotion_readiness: 'promoted',
    recurring_candidate: true,
    cooldown_until: now + COOLDOWN_MS,
    cooldown_reason: 'reopened',
    severity_max: sevMax,
    updated_at: now,
  }
}

// ── Cooldown management ──

/**
 * Tick cooldowns: move promoted past window → cooldown, expired cooldowns → closed.
 */
export function tickCooldowns(): { cooled: number; closed: number } {
  const db = getDb()
  const now = Date.now()

  const cooled = db.prepare(`
    UPDATE insights SET status = 'cooldown', cooldown_reason = 'auto-cooldown', updated_at = ?
    WHERE status = 'promoted' AND cooldown_until IS NOT NULL AND cooldown_until <= ?
  `).run(now, now)

  const closed = db.prepare(`
    UPDATE insights SET status = 'closed', updated_at = ?
    WHERE status = 'cooldown' AND updated_at < ?
  `).run(now, now - COOLDOWN_MS)

  return { cooled: cooled.changes, closed: closed.changes }
}

// ── CRUD ──

export function getInsight(id: string): Insight | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM insights WHERE id = ?').get(id) as InsightRow | undefined
  return row ? rowToInsight(row) : null
}

export interface InsightListOpts {
  status?: string
  priority?: string
  workflow_stage?: string
  failure_family?: string
  impacted_unit?: string
  limit?: number
  offset?: number
}

export function listInsights(opts: InsightListOpts = {}): { insights: Insight[]; total: number } {
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []

  if (opts.status && opts.status !== 'all') { where.push('status = ?'); params.push(opts.status) }
  if (opts.priority) { where.push('priority = ?'); params.push(opts.priority) }
  if (opts.workflow_stage) { where.push('workflow_stage = ?'); params.push(opts.workflow_stage) }
  if (opts.failure_family) { where.push('failure_family = ?'); params.push(opts.failure_family) }
  if (opts.impacted_unit) { where.push('impacted_unit = ?'); params.push(opts.impacted_unit) }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.min(opts.limit ?? 50, 200)
  const offset = opts.offset ?? 0

  const total = (db.prepare(`SELECT COUNT(*) as c FROM insights ${whereClause}`).get(...params) as { c: number }).c
  const rows = db.prepare(
    `SELECT * FROM insights ${whereClause} ORDER BY score DESC, created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as InsightRow[]

  return { insights: rows.map(rowToInsight), total }
}

export function insightStats(): {
  total: number
  by_status: Record<string, number>
  by_priority: Record<string, number>
  by_failure_family: Record<string, number>
} {
  const db = getDb()

  const total = (db.prepare('SELECT COUNT(*) as c FROM insights').get() as { c: number }).c
  const byStatus = db.prepare('SELECT status, COUNT(*) as c FROM insights GROUP BY status').all() as Array<{ status: string; c: number }>
  const byPriority = db.prepare('SELECT priority, COUNT(*) as c FROM insights GROUP BY priority').all() as Array<{ priority: string; c: number }>
  const byFamily = db.prepare('SELECT failure_family, COUNT(*) as c FROM insights GROUP BY failure_family ORDER BY c DESC LIMIT 20').all() as Array<{ failure_family: string; c: number }>

  return {
    total,
    by_status: Object.fromEntries(byStatus.map(r => [r.status, r.c])),
    by_priority: Object.fromEntries(byPriority.map(r => [r.priority, r.c])),
    by_failure_family: Object.fromEntries(byFamily.map(r => [r.failure_family, r.c])),
  }
}

// ── Internal helpers ──

function loadReflectionsById(ids: string[]): Reflection[] {
  if (ids.length === 0) return []
  const db = getDb()
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(`SELECT * FROM reflections WHERE id IN (${placeholders})`).all(...ids) as any[]
  return rows.map(row => ({
    id: row.id,
    pain: row.pain,
    impact: row.impact,
    evidence: safeJsonParse<string[]>(row.evidence) ?? [],
    went_well: row.went_well,
    suspected_why: row.suspected_why,
    proposed_fix: row.proposed_fix,
    confidence: row.confidence,
    role_type: row.role_type,
    severity: row.severity ?? undefined,
    author: row.author,
    task_id: row.task_id ?? undefined,
    tags: safeJsonParse<string[]>(row.tags),
    team_id: row.team_id ?? undefined,
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))
}

// ── Test helpers ──

export function _clearInsightStore(): void {
  try {
    const db = getDb()
    db.prepare('DELETE FROM insights').run()
  } catch {
    // Table may not exist
  }
}

/**
 * Update an insight's status and optionally link a task.
 * Used by the insight→task bridge when auto-creating or triaging.
 */
export function updateInsightStatus(
  insightId: string,
  status: InsightStatus,
  taskId?: string,
): boolean {
  const db = getDb()
  const now = Date.now()
  if (taskId) {
    const result = db.prepare(
      'UPDATE insights SET status = ?, task_id = ?, updated_at = ? WHERE id = ?'
    ).run(status, taskId, now, insightId)
    return result.changes > 0
  } else {
    const result = db.prepare(
      'UPDATE insights SET status = ?, updated_at = ? WHERE id = ?'
    ).run(status, now, insightId)
    return result.changes > 0
  }
}

export { COOLDOWN_MS, PROMOTION_THRESHOLD }
