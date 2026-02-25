// SPDX-License-Identifier: Apache-2.0
// Insight clustering + dedupe/cooldown engine
// Clusters reflections → insights with promotion gates and cooldown controls

import { getDb, safeJsonStringify, safeJsonParse } from './db.js'
import { eventBus } from './events.js'
import type { Reflection } from './reflections.js'

// ── Constants ──

const COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24 hours

// v1.1: 2-unique-authors gate is tuned for a small team (~6-8 agents).
// At scale, replace with a ratio/volume gate: max(2, ceil(team_size * X%))
const PROMOTION_THRESHOLD = 2             // independent reflections needed

// v1.1: max reopen count per 24h sliding window. After this, route to pending_triage.
const MAX_REOPEN_COUNT_24H = 3

/** Scoring engine version — increment on any rule change for audit trail */
export const SCORING_ENGINE_VERSION = '1.1.0'

// ── Hysteresis config ──
// Buffer zone around priority thresholds to prevent flapping.
// A score must cross threshold + buffer to change priority upward,
// or drop below threshold - buffer to change downward.
export const HYSTERESIS_BUFFER = 0.3
export const PRIORITY_THRESHOLDS = { P0: 8, P1: 5, P2: 3 } as const

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

/**
 * Derive priority from score (no hysteresis — used for initial assignment).
 */
export function scoreToPriority(score: number): string {
  if (score >= PRIORITY_THRESHOLDS.P0) return 'P0'
  if (score >= PRIORITY_THRESHOLDS.P1) return 'P1'
  if (score >= PRIORITY_THRESHOLDS.P2) return 'P2'
  return 'P3'
}

/**
 * Priority with hysteresis: prevents flapping near threshold boundaries.
 *
 * - To upgrade priority (e.g. P1→P0), score must exceed threshold + buffer
 * - To downgrade (e.g. P0→P1), score must drop below threshold - buffer
 * - If score is in the buffer zone, previous priority is retained
 */
export function scoreToPriorityWithHysteresis(score: number, previousPriority: string | null): string {
  if (!previousPriority) return scoreToPriority(score)

  const buf = HYSTERESIS_BUFFER
  const { P0, P1, P2 } = PRIORITY_THRESHOLDS

  if (previousPriority === 'P0') {
    if (score >= P0 - buf) return 'P0'
  }
  if (previousPriority === 'P1') {
    if (score >= P0 + buf) return 'P0'
    if (score >= P1 - buf) return 'P1'
  }
  if (previousPriority === 'P2') {
    if (score >= P0 + buf) return 'P0'
    if (score >= P1 + buf) return 'P1'
    if (score >= P2 - buf) return 'P2'
  }
  if (previousPriority === 'P3') {
    if (score >= P0 + buf) return 'P0'
    if (score >= P1 + buf) return 'P1'
    if (score >= P2 + buf) return 'P2'
    return 'P3'
  }

  return scoreToPriority(score)
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

  // v1.1: volumeBoost cap=2 — flag for day-7 review (n=10 and n=5 score similarly)
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
 * NOTE: When a reflection lacks explicit `unit:` / `stage:` tags, we try to
 * avoid collapsing everything into `unknown::*::unknown` by:
 *  - deriving unit from the first non-reserved tag (e.g. `chat`, `status-discipline`)
 *  - as a last resort, deriving a short topic signature from the pain text
 */
export function extractClusterKey(reflection: Reflection): InsightClusterKey {
  const tags = reflection.tags ?? []

  const stageRaw = tags.find(t => t.startsWith('stage:'))?.slice(6) ?? 'unknown'
  const familyRaw = tags.find(t => t.startsWith('family:'))?.slice(7) ?? _inferFailureFamily(reflection.pain)

  const explicitUnit = tags.find(t => t.startsWith('unit:'))?.slice(5)
  let unitRaw = explicitUnit
    ?? _inferImpactedUnitFromTags(tags)
    ?? reflection.team_id
    ?? 'unknown'

  // If we still have no unit, derive a small topic signature so unrelated
  // reflections don't cluster into the same `unknown::*::unknown` bucket.
  if (!explicitUnit && (!unitRaw || unitRaw === 'unknown')) {
    const topic = _inferTopicFromPain(reflection.pain)
    if (topic) unitRaw = topic
  }

  return {
    workflow_stage: _sanitizeClusterPart(stageRaw) || 'unknown',
    failure_family: _sanitizeClusterPart(familyRaw) || 'uncategorized',
    impacted_unit: _sanitizeClusterPart(unitRaw) || 'unknown',
  }
}

function _sanitizeClusterPart(part: string | null | undefined): string {
  if (!part) return ''
  return part
    .trim()
    .toLowerCase()
    // prevent delimiter collisions
    .replace(/::+/g, '-')
    .replace(/:+/g, '-')
    .replace(/\s+/g, '-')
    // keep keys compact + url/db friendly
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 64)
}

function _inferImpactedUnitFromTags(tags: string[]): string | null {
  if (!tags || tags.length === 0) return null

  const reservedPrefixes = ['stage:', 'family:', 'unit:', 'team:']
  const candidates = tags
    .map(t => t.trim())
    .filter(Boolean)
    .filter(t => !reservedPrefixes.some(p => t.startsWith(p)))

  if (candidates.length === 0) return null

  // Prefer a non-generic tag if possible, but keep deterministic ordering.
  const generic = new Set([
    'performance', 'data-loss', 'runtime-error', 'access', 'ui', 'config', 'deployment', 'testing', 'uncategorized',
    'memory', 'latency', 'timeout',
  ])

  return candidates.find(t => !generic.has(t.toLowerCase())) ?? candidates[0]
}

function _inferTopicFromPain(pain: string): string | null {
  const lower = (pain || '').toLowerCase()
  if (!lower.trim()) return null

  // Simple, stable signature: first 3 meaningful words (len>=4), stopword-filtered.
  const stop = new Set(['this', 'that', 'with', 'from', 'into', 'onto', 'when', 'then', 'than', 'over', 'under', 'only', 'just', 'some', 'much', 'very', 'more', 'most', 'less', 'have', 'has', 'had', 'been', 'were', 'was', 'are', 'and', 'the', 'for', 'but', 'not', 'too', 'yet'])
  const words = lower
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 4)
    .filter(w => !stop.has(w))

  if (words.length === 0) return null
  const sig = words.slice(0, 3).join('-')
  return `topic-${sig}`
}

function _inferFailureFamily(pain: string): string {
  const lower = pain.toLowerCase()
  if (/truncat|cut.?off|missing.?text|incomplete/i.test(lower)) return 'data-loss'
  if (/crash|exception|error|fail/i.test(lower)) return 'runtime-error'
  if (/slow|timeout|latency|performance/i.test(lower)) return 'performance'
  if (/auth|permission|denied|forbidden/i.test(lower)) return 'access'
  if (/ui|display|render|layout|style/i.test(lower)) return 'ui'
  if (/config|setting|env/i.test(lower)) return 'config'
  if (/deploy|release|build|ci/i.test(lower)) return 'deployment'
  if (/test|coverage|flak/i.test(lower)) return 'testing'
  return 'uncategorized'
}

// ── Audit / Decision Trace ──

export interface DecisionTrace {
  version: string
  dedupe_cluster_id: string
  promotion_band: PromotionReadiness
  top_contributors: Array<{ factor: string; value: number; description: string }>
  hysteresis_applied: boolean
  previous_priority: string | null
  raw_score: number
}

export function buildDecisionTrace(
  reflections: Reflection[],
  clusterKeyStr: string,
  readiness: PromotionReadiness,
  previousPriority: string | null,
  score: number,
): DecisionTrace {
  const maxConf = reflections.length > 0 ? Math.max(...reflections.map(r => r.confidence)) : 0
  const severityBoost = reflections.reduce((max, r) => {
    if (r.severity === 'critical') return Math.max(max, 2)
    if (r.severity === 'high') return Math.max(max, 1)
    return max
  }, 0)
  const volumeBoost = Math.min((reflections.length - 1) * 0.5, 2)

  const contributors: DecisionTrace['top_contributors'] = []
  contributors.push({ factor: 'max_confidence', value: maxConf, description: 'Highest reflection confidence' })
  if (severityBoost > 0) contributors.push({ factor: 'severity_boost', value: severityBoost, description: 'Max severity boost (high=+1, critical=+2)' })
  if (volumeBoost > 0) contributors.push({ factor: 'volume_boost', value: volumeBoost, description: `${reflections.length} reflections (+0.5 each, max +2)` })

  const withHysteresis = scoreToPriorityWithHysteresis(score, previousPriority)
  const without = scoreToPriority(score)

  return {
    version: SCORING_ENGINE_VERSION,
    dedupe_cluster_id: clusterKeyStr,
    promotion_band: readiness,
    top_contributors: contributors.sort((a, b) => b.value - a.value),
    hysteresis_applied: withHysteresis !== without,
    previous_priority: previousPriority,
    raw_score: score,
  }
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
    // Cooldown: if in cooldown and new reflection arrives, check reopen cap then reopen
    if (existing.status === 'cooldown') {
      if (existing.cooldown_until && now < existing.cooldown_until) {
        // v1.1: enforce max reopen count (3 per 24h) — route to pending_triage if exceeded
        const reopenCount = countRecentReopens(existing)
        if (reopenCount >= MAX_REOPEN_COUNT_24H) {
          return routeToPendingTriage(existing, reflection, 'reopen_cap_exceeded')
        }
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

  // Build initial decision trace for audit
  const decisionTrace = buildDecisionTrace(reflections, clusterKeyStr, readiness, null, score)
  const metadata: Record<string, unknown> = {
    decision_trace: decisionTrace,
    dedupe_cluster_id: clusterKeyStr,
    promotion_band: readiness,
    scoring_version: SCORING_ENGINE_VERSION,
  }

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
    metadata,
    created_at: now,
    updated_at: now,
  }

  db.prepare(`
    INSERT INTO insights (
      id, cluster_key, workflow_stage, failure_family, impacted_unit,
      title, status, score, priority, reflection_ids, independent_count,
      evidence_refs, authors, promotion_readiness, recurring_candidate,
      cooldown_until, cooldown_reason, severity_max, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, clusterKeyStr, key.workflow_stage, key.failure_family, key.impacted_unit,
    title, status, score, priority,
    safeJsonStringify(insight.reflection_ids),
    1,
    safeJsonStringify(evidenceRefs),
    safeJsonStringify(authors),
    readiness, 0,
    cooldownUntil, cooldownReason, sevMax,
    safeJsonStringify(metadata),
    now, now,
  )

  if (shouldPromote) {
    eventBus.emit({
      id: `evt-insight-promoted-${id}`,
      type: 'insight_created' as const,
      timestamp: Date.now(),
      data: { kind: 'insight:promoted', insightId: id, priority, score },
    })
  } else {
    eventBus.emit({
      id: `evt-insight-created-${id}`,
      type: 'insight_created' as const,
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
  const sevMax = maxSeverity(allReflections)

  const wasCandidate = existing.status === 'candidate'
  const shouldPromote = wasCandidate && canPromote(allReflections)

  // Apply hysteresis to prevent priority flapping
  const priority = scoreToPriorityWithHysteresis(score, existing.priority)

  const status: InsightStatus = shouldPromote ? 'promoted' : existing.status
  const readiness: PromotionReadiness = shouldPromote
    ? (updatedAuthors.length >= PROMOTION_THRESHOLD ? 'promoted' : 'override')
    : (canPromote(allReflections) ? 'ready' : existing.promotion_readiness)
  const cooldownUntil = shouldPromote ? now + COOLDOWN_MS : existing.cooldown_until
  const cooldownReason = shouldPromote ? 'auto-promoted' : existing.cooldown_reason

  // Recurring if reopened or has many reflections
  const recurring = updatedIds.length >= 4

  // Build decision trace for audit
  const decisionTrace = buildDecisionTrace(allReflections, existing.cluster_key, readiness, existing.priority, score)
  const updatedMetadata = {
    ...(existing.metadata || {}),
    decision_trace: decisionTrace,
    dedupe_cluster_id: existing.cluster_key,
    promotion_band: readiness,
    scoring_version: SCORING_ENGINE_VERSION,
  }

  db.prepare(`
    UPDATE insights SET
      reflection_ids = ?, independent_count = ?, evidence_refs = ?,
      authors = ?, score = ?, priority = ?, status = ?,
      promotion_readiness = ?, recurring_candidate = ?,
      cooldown_until = ?, cooldown_reason = ?, severity_max = ?,
      metadata = ?, updated_at = ?
    WHERE id = ?
  `).run(
    safeJsonStringify(updatedIds),
    updatedAuthors.length,
    safeJsonStringify(updatedEvidence),
    safeJsonStringify(updatedAuthors),
    score, priority, status,
    readiness, recurring ? 1 : 0,
    cooldownUntil, cooldownReason, sevMax,
    safeJsonStringify(updatedMetadata),
    now,
    existing.id,
  )

  if (shouldPromote && wasCandidate) {
    eventBus.emit({
      id: `evt-insight-promoted-${existing.id}`,
      type: 'insight_created' as const,
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
    metadata: updatedMetadata,
    updated_at: now,
  }
}

/**
 * Count recent reopens for an insight within a 24h sliding window.
 * Uses reopen_count and reopen_window_start stored directly on the insight row.
 * Resets window if >24h has passed since the window started.
 */
function countRecentReopens(existing: Insight): number {
  const now = Date.now()
  const meta = (existing.metadata ?? {}) as Record<string, unknown>
  const windowStart = (meta.reopen_window_start as number) ?? 0
  const count = (meta.reopen_count_24h as number) ?? 0

  // If window has expired (>24h), count resets
  if (now - windowStart > COOLDOWN_MS) {
    return 0
  }
  return count
}

/**
 * Route an insight to pending_triage when reopen cap is exceeded.
 * v1.1: prevents repeated auto-promote loops while capturing recurrence signal.
 */
function routeToPendingTriage(existing: Insight, reflection: Reflection, reason: string): Insight {
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
      status = 'pending_triage', reflection_ids = ?, independent_count = ?,
      evidence_refs = ?, authors = ?, score = ?, priority = ?,
      promotion_readiness = 'promoted', recurring_candidate = 1,
      cooldown_reason = ?, severity_max = ?, updated_at = ?
    WHERE id = ?
  `).run(
    safeJsonStringify(updatedIds),
    updatedAuthors.length,
    safeJsonStringify(updatedEvidence),
    safeJsonStringify(updatedAuthors),
    score, priority,
    reason, sevMax, now,
    existing.id,
  )

  eventBus.emit({
    id: `evt-insight-triage-${existing.id}-${now}`,
    type: 'task_updated' as const,
    timestamp: now,
    data: { kind: 'insight:reopen_cap_exceeded', insightId: existing.id, reopenReason: reason },
  })

  return {
    ...existing,
    status: 'pending_triage',
    reflection_ids: updatedIds,
    independent_count: updatedAuthors.length,
    evidence_refs: updatedEvidence,
    authors: updatedAuthors,
    score,
    priority,
    promotion_readiness: 'promoted',
    recurring_candidate: true,
    cooldown_reason: reason,
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

  // v1.1: track reopen count in metadata for cap enforcement
  const meta = (existing.metadata ?? {}) as Record<string, unknown>
  const windowStart = (meta.reopen_window_start as number) ?? 0
  const prevCount = (meta.reopen_count_24h as number) ?? 0
  const windowExpired = now - windowStart > COOLDOWN_MS
  const newCount = windowExpired ? 1 : prevCount + 1
  const newWindowStart = windowExpired ? now : windowStart
  const updatedMetadata = { ...meta, reopen_count_24h: newCount, reopen_window_start: newWindowStart }

  db.prepare(`
    UPDATE insights SET
      status = 'promoted', reflection_ids = ?, independent_count = ?,
      evidence_refs = ?, authors = ?, score = ?, priority = ?,
      promotion_readiness = 'promoted', recurring_candidate = 1,
      cooldown_until = ?, cooldown_reason = 'reopened',
      severity_max = ?, metadata = ?, updated_at = ?
    WHERE id = ?
  `).run(
    safeJsonStringify(updatedIds),
    updatedAuthors.length,
    safeJsonStringify(updatedEvidence),
    safeJsonStringify(updatedAuthors),
    score, priority,
    now + COOLDOWN_MS,
    sevMax, safeJsonStringify(updatedMetadata), now,
    existing.id,
  )

  eventBus.emit({
    id: `evt-insight-reopened-${existing.id}`,
    type: 'task_updated' as const,
    timestamp: Date.now(),
    data: { kind: 'insight:reopened', insightId: existing.id, reopenCount: newCount },
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
    metadata: updatedMetadata,
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

export { COOLDOWN_MS, PROMOTION_THRESHOLD, SCORING_ENGINE_VERSION as _SCORING_ENGINE_VERSION }

// ── Reconciler: find promoted insights without task links ──

export function getOrphanedInsights(): Insight[] {
  const db = getDb()
  const rows = db.prepare(
    "SELECT * FROM insights WHERE status IN ('promoted', 'task_created') AND (task_id IS NULL OR task_id = '') ORDER BY score DESC"
  ).all() as InsightRow[]
  return rows.map(rowToInsight)
}

export interface ReconcileResult {
  scanned: number
  linked: number
  created: number
  skipped: number
  errors: string[]
  details: Array<{ insight_id: string; action: string; task_id?: string; reason?: string }>
}

export function reconcileInsightTaskLinks(
  createTaskFn: (insight: Insight) => { taskId: string } | null,
  dryRun = false,
): ReconcileResult {
  const orphans = getOrphanedInsights()
  const result: ReconcileResult = {
    scanned: orphans.length,
    linked: 0,
    created: 0,
    skipped: 0,
    errors: [],
    details: [],
  }

  for (const insight of orphans) {
    try {
      if (dryRun) {
        result.details.push({ insight_id: insight.id, action: 'would_create', reason: 'dry run' })
        result.created++
        continue
      }

      const taskResult = createTaskFn(insight)
      if (taskResult) {
        updateInsightStatus(insight.id, 'task_created', taskResult.taskId)
        result.created++
        result.details.push({ insight_id: insight.id, action: 'created', task_id: taskResult.taskId })
      } else {
        result.skipped++
        result.details.push({ insight_id: insight.id, action: 'skipped', reason: 'createTaskFn returned null' })
      }
    } catch (err) {
      result.errors.push(`${insight.id}: ${(err as Error).message}`)
      result.details.push({ insight_id: insight.id, action: 'error', reason: (err as Error).message })
    }
  }

  return result
}
