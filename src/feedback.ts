// SPDX-License-Identifier: Apache-2.0
// Feedback collection: in-memory store + CRUD + triage pipeline

import { randomUUID } from 'crypto'

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
  const record: FeedbackRecord = {
    ...submission,
    id,
    status: 'new',
    votes: 0,
    severity,
    reporterType,
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
  sort?: 'date' | 'votes' | 'severity'
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

export function listFeedback(query: FeedbackQuery = {}): { items: FeedbackListItem[]; total: number; newCount: number } {
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

  const total = items.length
  const newCount = Array.from(feedbackStore.values()).filter(f => f.status === 'new').length

  // Sort
  const sortBy = query.sort || 'date'
  const order = query.order || 'desc'
  items.sort((a, b) => {
    if (sortBy === 'votes') return order === 'desc' ? b.votes - a.votes : a.votes - b.votes
    if (sortBy === 'severity') {
      const diff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      return order === 'desc' ? -diff : diff
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
    })),
    total,
    newCount,
  }
}

export function getFeedback(id: string): FeedbackRecord | undefined {
  return feedbackStore.get(id)
}

export function updateFeedback(id: string, patch: Partial<Pick<FeedbackRecord, 'status' | 'notes' | 'assignedTo' | 'votes' | 'severity'>>): FeedbackRecord | null {
  const record = feedbackStore.get(id)
  if (!record) return null

  if (patch.status !== undefined) record.status = patch.status
  if (patch.notes !== undefined) record.notes = patch.notes
  if (patch.assignedTo !== undefined) record.assignedTo = patch.assignedTo
  if (patch.votes !== undefined) record.votes = patch.votes
  if (patch.severity !== undefined) record.severity = patch.severity
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
  }
}

export function buildTriageTask(input: TriageInput): TriageTaskPayload | { error: string } {
  const record = feedbackStore.get(input.feedbackId)
  if (!record) return { error: 'Feedback not found' }
  if (record.status === 'triaged' && record.triageResult) {
    return { error: `Already triaged as task ${record.triageResult.taskId}` }
  }

  const priority = input.priority || SEVERITY_TO_PRIORITY[record.severity]
  const categoryLabel = record.category === 'bug' ? 'Bug' : record.category === 'feature' ? 'Feature request' : 'Feedback'
  const title = input.title || `[${categoryLabel}] ${record.message.slice(0, 80)}`

  const description = [
    `**Source**: Feedback ${record.id} (${record.reporterType})`,
    record.reporterAgent ? `**Reporter agent**: ${record.reporterAgent}` : null,
    record.email ? `**Reporter email**: ${record.email}` : null,
    `**Category**: ${record.category}`,
    `**Severity**: ${record.severity}`,
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
}

export function getTriageQueue(): { items: TriageQueueItem[]; total: number } {
  const newItems = Array.from(feedbackStore.values())
    .filter(f => f.status === 'new')
    .sort((a, b) => {
      // Sort by severity first, then by date
      const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      if (sevDiff !== 0) return sevDiff
      return b.createdAt - a.createdAt
    })

  return {
    items: newItems.map(f => ({
      feedbackId: f.id,
      category: f.category,
      severity: f.severity,
      reporterType: f.reporterType,
      messagePreview: f.message.slice(0, 120),
      createdAt: f.createdAt,
      votes: f.votes,
      suggestedPriority: SEVERITY_TO_PRIORITY[f.severity],
    })),
    total: newItems.length,
  }
}

// Export for testing
export function _clearFeedbackStore(): void {
  feedbackStore.clear()
  rateLimits.clear()
}
