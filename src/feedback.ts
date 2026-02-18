// SPDX-License-Identifier: Apache-2.0
// Feedback collection: in-memory store + CRUD + triage pipeline + support tier SLA

import { randomUUID } from 'crypto'

// ── Support Tier Policy ──

export type SupportTier = 'free' | 'pro' | 'team'

export interface SLAPolicy {
  tier: SupportTier
  /** First response SLA in milliseconds */
  responseSlaMs: number
  /** Resolution target SLA in milliseconds */
  resolutionSlaMs: number
  /** Priority boost — how many severity levels to escalate (0 = none) */
  priorityBoost: number
  /** Human description */
  label: string
}

const HOUR = 3_600_000
const DAY = 86_400_000

export const TIER_POLICIES: Record<SupportTier, SLAPolicy> = {
  free: {
    tier: 'free',
    responseSlaMs: 72 * HOUR,      // 72h first response
    resolutionSlaMs: 14 * DAY,     // 14 days resolution
    priorityBoost: 0,
    label: 'Free — best effort',
  },
  pro: {
    tier: 'pro',
    responseSlaMs: 24 * HOUR,      // 24h first response
    resolutionSlaMs: 7 * DAY,      // 7 days resolution
    priorityBoost: 1,
    label: 'Pro — priority support',
  },
  team: {
    tier: 'team',
    responseSlaMs: 4 * HOUR,       // 4h first response
    resolutionSlaMs: 2 * DAY,      // 48h resolution
    priorityBoost: 2,
    label: 'Team — dedicated SLA',
  },
}

export type BreachRisk = 'none' | 'approaching' | 'at_risk' | 'breached'

export interface SLAStatus {
  tier: SupportTier
  responseSlaMs: number
  resolutionSlaMs: number
  responseElapsedMs: number
  resolutionElapsedMs: number
  responseBreachRisk: BreachRisk
  resolutionBreachRisk: BreachRisk
  /** Overall breach risk (worst of response + resolution) */
  overallBreachRisk: BreachRisk
  respondedAt?: number
}

/**
 * Compute breach risk for a single SLA timer.
 * Thresholds: >100% = breached, >75% = at_risk, >50% = approaching, else none
 */
export function computeBreachRisk(elapsedMs: number, slaMs: number): BreachRisk {
  if (slaMs <= 0) return 'none'
  const ratio = elapsedMs / slaMs
  if (ratio >= 1.0) return 'breached'
  if (ratio >= 0.75) return 'at_risk'
  if (ratio >= 0.5) return 'approaching'
  return 'none'
}

const BREACH_ORDER: Record<BreachRisk, number> = { none: 0, approaching: 1, at_risk: 2, breached: 3 }

function worstBreachRisk(a: BreachRisk, b: BreachRisk): BreachRisk {
  return BREACH_ORDER[a] >= BREACH_ORDER[b] ? a : b
}

/**
 * Compute full SLA status for a feedback record at a given point in time.
 */
export function computeSLAStatus(record: FeedbackRecord, now: number = Date.now()): SLAStatus {
  const tier = record.tier || 'free'
  const policy = TIER_POLICIES[tier]

  const responseElapsedMs = record.respondedAt
    ? record.respondedAt - record.createdAt
    : now - record.createdAt
  const resolutionElapsedMs = now - record.createdAt

  const responseBreachRisk = record.respondedAt
    ? computeBreachRisk(record.respondedAt - record.createdAt, policy.responseSlaMs)
    : computeBreachRisk(responseElapsedMs, policy.responseSlaMs)
  const resolutionBreachRisk = record.status === 'triaged'
    ? 'none' as BreachRisk  // resolved records don't accumulate resolution risk
    : computeBreachRisk(resolutionElapsedMs, policy.resolutionSlaMs)

  return {
    tier,
    responseSlaMs: policy.responseSlaMs,
    resolutionSlaMs: policy.resolutionSlaMs,
    responseElapsedMs,
    resolutionElapsedMs,
    responseBreachRisk,
    resolutionBreachRisk,
    overallBreachRisk: worstBreachRisk(responseBreachRisk, resolutionBreachRisk),
    respondedAt: record.respondedAt,
  }
}

// ── Types ──

export type FeedbackCategory = 'bug' | 'feature' | 'general'
export type FeedbackSeverity = 'critical' | 'high' | 'medium' | 'low'
export type FeedbackReporterType = 'human' | 'agent'
export type FeedbackStatus = 'new' | 'triaged' | 'archived'

export interface FeedbackSubmission {
  category: FeedbackCategory
  message: string
  email?: string
  url?: string
  userAgent?: string
  sessionId?: string
  siteToken: string
  timestamp: number
  severity?: FeedbackSeverity
  reporterType?: FeedbackReporterType
  reporterAgent?: string  // agent name if reporterType === 'agent'
  /** Support tier — looked up from org/plan or provided explicitly */
  tier?: SupportTier
}

export interface FeedbackRecord extends FeedbackSubmission {
  id: string
  status: FeedbackStatus
  votes: number
  createdAt: number
  updatedAt: number
  notes?: string
  assignedTo?: string
  severity: FeedbackSeverity
  reporterType: FeedbackReporterType
  triageResult?: TriageResult
  /** Support tier — determines SLA policy */
  tier: SupportTier
  /** Timestamp when first response was sent (undefined = not yet responded) */
  respondedAt?: number
}

export interface TriageResult {
  taskId: string
  triageAgent: string
  triagedAt: number
  priority: string
  assignee?: string
}

export interface FeedbackListItem {
  id: string
  category: FeedbackRecord['category']
  messagePreview: string
  status: FeedbackRecord['status']
  severity: FeedbackSeverity
  reporterType: FeedbackReporterType
  votes: number
  createdAt: number
  email?: string
  url?: string
  assignedTo?: string
  triageResult?: TriageResult
  tier: SupportTier
  sla: SLAStatus
}

// ── Severity inference ──

const CRITICAL_PATTERNS = /\b(crash|data loss|security|auth broken|production down|can't login|can't sign in)\b/i
const HIGH_PATTERNS = /\b(broken|fails|error|not working|can't|unable to|blocks|regression)\b/i
const MEDIUM_PATTERNS = /\b(slow|confusing|unexpected|wrong|incorrect|missing)\b/i

export function inferSeverity(category: FeedbackCategory, message: string): FeedbackSeverity {
  if (category === 'bug') {
    if (CRITICAL_PATTERNS.test(message)) return 'critical'
    if (HIGH_PATTERNS.test(message)) return 'high'
    return 'medium'
  }
  if (category === 'feature') return 'low'
  // general
  if (HIGH_PATTERNS.test(message)) return 'medium'
  return 'low'
}

// ── Rate limiter ──
const rateLimits = new Map<string, { count: number; windowStart: number }>()
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60_000

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now()
  const entry = rateLimits.get(ip)
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimits.set(ip, { count: 1, windowStart: now })
    return { allowed: true }
  }
  if (entry.count >= RATE_LIMIT) {
    const retryAfterSec = Math.ceil((entry.windowStart + RATE_WINDOW_MS - now) / 1000)
    return { allowed: false, retryAfterSec }
  }
  entry.count++
  return { allowed: true }
}

// ── Feedback store (in-memory, v1) ──
const feedbackStore = new Map<string, FeedbackRecord>()

export function submitFeedback(submission: FeedbackSubmission): FeedbackRecord {
  const id = `fb-${randomUUID().slice(0, 8)}`
  const now = Date.now()
  const severity = submission.severity || inferSeverity(submission.category, submission.message)
  const reporterType = submission.reporterType || 'human'
  const tier = submission.tier || 'free'
  const record: FeedbackRecord = {
    ...submission,
    id,
    status: 'new',
    votes: 0,
    severity,
    reporterType,
    tier,
    createdAt: now,
    updatedAt: now,
  }
  feedbackStore.set(id, record)
  return record
}

export interface FeedbackQuery {
  status?: FeedbackStatus | 'all'
  category?: FeedbackCategory | 'all'
  severity?: FeedbackSeverity | 'all'
  reporterType?: FeedbackReporterType | 'all'
  tier?: SupportTier | 'all'
  sort?: 'date' | 'votes' | 'severity' | 'breach_risk'
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

const SEVERITY_ORDER: Record<FeedbackSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function listFeedback(query: FeedbackQuery = {}): { items: FeedbackListItem[]; total: number; newCount: number; breachedCount: number } {
  const now = Date.now()
  let items = Array.from(feedbackStore.values())

  // Filter by status
  const statusFilter = query.status || 'new'
  if (statusFilter !== 'all') {
    items = items.filter(f => f.status === statusFilter)
  }

  // Filter by category
  if (query.category && query.category !== 'all') {
    items = items.filter(f => f.category === query.category)
  }

  // Filter by severity
  if (query.severity && query.severity !== 'all') {
    items = items.filter(f => f.severity === query.severity)
  }

  // Filter by reporter type
  if (query.reporterType && query.reporterType !== 'all') {
    items = items.filter(f => f.reporterType === query.reporterType)
  }

  // Filter by tier
  if (query.tier && query.tier !== 'all') {
    items = items.filter(f => (f.tier || 'free') === query.tier)
  }

  const total = items.length
  const newCount = Array.from(feedbackStore.values()).filter(f => f.status === 'new').length
  const breachedCount = Array.from(feedbackStore.values()).filter(f => {
    if (f.status === 'triaged' || f.status === 'archived') return false
    return computeSLAStatus(f, now).overallBreachRisk === 'breached'
  }).length

  // Sort
  const sortBy = query.sort || 'date'
  const order = query.order || 'desc'
  items.sort((a, b) => {
    if (sortBy === 'votes') return order === 'desc' ? b.votes - a.votes : a.votes - b.votes
    if (sortBy === 'severity') {
      const diff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      return order === 'desc' ? -diff : diff
    }
    if (sortBy === 'breach_risk') {
      const slaA = computeSLAStatus(a, now)
      const slaB = computeSLAStatus(b, now)
      const diff = BREACH_ORDER[slaB.overallBreachRisk] - BREACH_ORDER[slaA.overallBreachRisk]
      if (diff !== 0) return order === 'desc' ? diff : -diff
      // Secondary: tier priority (team > pro > free)
      const tierOrder: Record<SupportTier, number> = { team: 2, pro: 1, free: 0 }
      return tierOrder[b.tier || 'free'] - tierOrder[a.tier || 'free']
    }
    // date
    return order === 'desc' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt
  })

  // Pagination
  const offset = query.offset || 0
  const limit = Math.min(query.limit || 25, 100)
  items = items.slice(offset, offset + limit)

  return {
    items: items.map(f => ({
      id: f.id,
      category: f.category,
      messagePreview: f.message.slice(0, 120),
      status: f.status,
      severity: f.severity,
      reporterType: f.reporterType,
      votes: f.votes,
      createdAt: f.createdAt,
      email: f.email,
      url: f.url,
      assignedTo: f.assignedTo,
      triageResult: f.triageResult,
      tier: f.tier || 'free',
      sla: computeSLAStatus(f, now),
    })),
    total,
    newCount,
    breachedCount,
  }
}

export function getFeedback(id: string): FeedbackRecord | undefined {
  return feedbackStore.get(id)
}

export function updateFeedback(id: string, patch: Partial<Pick<FeedbackRecord, 'status' | 'notes' | 'assignedTo' | 'votes' | 'severity' | 'tier' | 'respondedAt'>>): FeedbackRecord | null {
  const record = feedbackStore.get(id)
  if (!record) return null

  if (patch.status !== undefined) record.status = patch.status
  if (patch.notes !== undefined) record.notes = patch.notes
  if (patch.assignedTo !== undefined) record.assignedTo = patch.assignedTo
  if (patch.votes !== undefined) record.votes = patch.votes
  if (patch.severity !== undefined) record.severity = patch.severity
  if (patch.tier !== undefined) record.tier = patch.tier
  if (patch.respondedAt !== undefined) record.respondedAt = patch.respondedAt
  record.updatedAt = Date.now()

  return record
}

export function voteFeedback(id: string): FeedbackRecord | null {
  const record = feedbackStore.get(id)
  if (!record) return null
  record.votes++
  record.updatedAt = Date.now()
  return record
}

// ── Triage pipeline ──

export interface TriageInput {
  feedbackId: string
  triageAgent: string  // who/what is triaging
  priority?: string    // override auto-mapped priority
  assignee?: string    // task assignee
  lane?: string        // task lane
  title?: string       // override auto-generated title
}

const SEVERITY_TO_PRIORITY: Record<FeedbackSeverity, string> = {
  critical: 'P0',
  high: 'P1',
  medium: 'P2',
  low: 'P3',
}

export interface TriageTaskPayload {
  title: string
  description: string
  priority: string
  assignee?: string
  lane?: string
  metadata: {
    source: 'feedback'
    feedbackId: string
    severity: FeedbackSeverity
    reporterType: FeedbackReporterType
    reporterAgent?: string
    reporterEmail?: string
    category: FeedbackCategory
    triagedBy: string
    triagedAt: number
    tier: SupportTier
    slaAtTriage: {
      responseBreachRisk: BreachRisk
      resolutionBreachRisk: BreachRisk
      responseElapsedMs: number
    }
  }
}

export function buildTriageTask(input: TriageInput): TriageTaskPayload | { error: string } {
  const record = feedbackStore.get(input.feedbackId)
  if (!record) return { error: 'Feedback not found' }
  if (record.status === 'triaged' && record.triageResult) {
    return { error: `Already triaged as task ${record.triageResult.taskId}` }
  }

  const tier = record.tier || 'free'
  const policy = TIER_POLICIES[tier]

  // Apply tier priority boost
  const basePriority = input.priority || SEVERITY_TO_PRIORITY[record.severity]
  const priorities = ['P0', 'P1', 'P2', 'P3']
  const baseIdx = priorities.indexOf(basePriority)
  const boostedIdx = baseIdx >= 0 ? Math.max(0, baseIdx - policy.priorityBoost) : baseIdx
  const priority = boostedIdx >= 0 ? priorities[boostedIdx] : basePriority

  const sla = computeSLAStatus(record)
  const categoryLabel = record.category === 'bug' ? 'Bug' : record.category === 'feature' ? 'Feature request' : 'Feedback'
  const tierLabel = tier !== 'free' ? ` [${tier.toUpperCase()}]` : ''
  const title = input.title || `[${categoryLabel}]${tierLabel} ${record.message.slice(0, 80)}`

  const description = [
    `**Source**: Feedback ${record.id} (${record.reporterType})`,
    `**Tier**: ${tier} (${policy.label})`,
    record.reporterAgent ? `**Reporter agent**: ${record.reporterAgent}` : null,
    record.email ? `**Reporter email**: ${record.email}` : null,
    `**Category**: ${record.category}`,
    `**Severity**: ${record.severity}`,
    sla.overallBreachRisk !== 'none' ? `**⚠️ SLA Risk**: ${sla.overallBreachRisk}` : null,
    record.url ? `**URL**: ${record.url}` : null,
    '',
    record.message,
  ].filter(Boolean).join('\n')

  return {
    title,
    description,
    priority,
    assignee: input.assignee,
    lane: input.lane,
    metadata: {
      source: 'feedback',
      feedbackId: record.id,
      severity: record.severity,
      reporterType: record.reporterType,
      reporterAgent: record.reporterAgent,
      reporterEmail: record.email,
      category: record.category,
      triagedBy: input.triageAgent,
      triagedAt: Date.now(),
      tier,
      slaAtTriage: {
        responseBreachRisk: sla.responseBreachRisk,
        resolutionBreachRisk: sla.resolutionBreachRisk,
        responseElapsedMs: sla.responseElapsedMs,
      },
    },
  }
}

export function markTriaged(feedbackId: string, taskId: string, triageAgent: string, priority: string, assignee?: string): FeedbackRecord | null {
  const record = feedbackStore.get(feedbackId)
  if (!record) return null

  record.status = 'triaged'
  record.triageResult = {
    taskId,
    triageAgent,
    triagedAt: Date.now(),
    priority,
    assignee,
  }
  record.updatedAt = Date.now()

  return record
}

// ── Triage queue view ──

export interface TriageQueueItem {
  feedbackId: string
  category: FeedbackCategory
  severity: FeedbackSeverity
  reporterType: FeedbackReporterType
  messagePreview: string
  createdAt: number
  votes: number
  suggestedPriority: string
  tier: SupportTier
  sla: SLAStatus
}

/**
 * Get triage queue sorted by breach risk (highest first), then tier, then severity.
 * This ensures SLA-breached items from paying tiers surface first.
 */
export function getTriageQueue(): { items: TriageQueueItem[]; total: number; breachedCount: number; atRiskCount: number } {
  const now = Date.now()
  const newItems = Array.from(feedbackStore.values())
    .filter(f => f.status === 'new')

  // Compute SLA for each item
  const enriched = newItems.map(f => ({
    record: f,
    sla: computeSLAStatus(f, now),
  }))

  // Sort: breach risk desc → tier desc → severity asc → date desc
  const tierOrder: Record<SupportTier, number> = { team: 2, pro: 1, free: 0 }
  enriched.sort((a, b) => {
    // Breach risk first (breached > at_risk > approaching > none)
    const breachDiff = BREACH_ORDER[b.sla.overallBreachRisk] - BREACH_ORDER[a.sla.overallBreachRisk]
    if (breachDiff !== 0) return breachDiff
    // Then tier (team > pro > free)
    const tierDiff = tierOrder[b.record.tier || 'free'] - tierOrder[a.record.tier || 'free']
    if (tierDiff !== 0) return tierDiff
    // Then severity
    const sevDiff = SEVERITY_ORDER[a.record.severity] - SEVERITY_ORDER[b.record.severity]
    if (sevDiff !== 0) return sevDiff
    return b.record.createdAt - a.record.createdAt
  })

  const breachedCount = enriched.filter(e => e.sla.overallBreachRisk === 'breached').length
  const atRiskCount = enriched.filter(e => e.sla.overallBreachRisk === 'at_risk').length

  // Apply tier priority boost to suggested priority
  function boostedPriority(severity: FeedbackSeverity, tier: SupportTier): string {
    const basePriority = SEVERITY_TO_PRIORITY[severity]
    const boost = TIER_POLICIES[tier].priorityBoost
    if (boost === 0) return basePriority
    const priorities = ['P0', 'P1', 'P2', 'P3']
    const baseIdx = priorities.indexOf(basePriority)
    const boostedIdx = Math.max(0, baseIdx - boost)
    return priorities[boostedIdx]
  }

  return {
    items: enriched.map(({ record: f, sla }) => ({
      feedbackId: f.id,
      category: f.category,
      severity: f.severity,
      reporterType: f.reporterType,
      messagePreview: f.message.slice(0, 120),
      createdAt: f.createdAt,
      votes: f.votes,
      suggestedPriority: boostedPriority(f.severity, f.tier || 'free'),
      tier: f.tier || 'free',
      sla,
    })),
    total: enriched.length,
    breachedCount,
    atRiskCount,
  }
}

// Export for testing
export function _clearFeedbackStore(): void {
  feedbackStore.clear()
  rateLimits.clear()
}
