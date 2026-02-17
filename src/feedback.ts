// SPDX-License-Identifier: Apache-2.0
// Feedback collection: in-memory store + CRUD for user feedback

import { randomUUID } from 'crypto'

export interface FeedbackSubmission {
  category: 'bug' | 'feature' | 'general'
  message: string
  email?: string
  url?: string
  userAgent?: string
  sessionId?: string
  siteToken: string
  timestamp: number
}

export interface FeedbackRecord extends FeedbackSubmission {
  id: string
  status: 'new' | 'triaged' | 'archived'
  votes: number
  createdAt: number
  updatedAt: number
  notes?: string
  assignedTo?: string
}

export interface FeedbackListItem {
  id: string
  category: FeedbackRecord['category']
  messagePreview: string
  status: FeedbackRecord['status']
  votes: number
  createdAt: number
  email?: string
  url?: string
  assignedTo?: string
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
  const record: FeedbackRecord = {
    ...submission,
    id,
    status: 'new',
    votes: 0,
    createdAt: now,
    updatedAt: now,
  }
  feedbackStore.set(id, record)
  return record
}

export interface FeedbackQuery {
  status?: 'new' | 'triaged' | 'archived' | 'all'
  category?: 'bug' | 'feature' | 'general' | 'all'
  sort?: 'date' | 'votes'
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
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

  const total = items.length
  const newCount = Array.from(feedbackStore.values()).filter(f => f.status === 'new').length

  // Sort
  const sortBy = query.sort || 'date'
  const order = query.order || 'desc'
  items.sort((a, b) => {
    const val = sortBy === 'votes' ? a.votes - b.votes : a.createdAt - b.createdAt
    return order === 'desc' ? -val : val
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
      votes: f.votes,
      createdAt: f.createdAt,
      email: f.email,
      url: f.url,
      assignedTo: f.assignedTo,
    })),
    total,
    newCount,
  }
}

export function getFeedback(id: string): FeedbackRecord | undefined {
  return feedbackStore.get(id)
}

export function updateFeedback(id: string, patch: Partial<Pick<FeedbackRecord, 'status' | 'notes' | 'assignedTo' | 'votes'>>): FeedbackRecord | null {
  const record = feedbackStore.get(id)
  if (!record) return null

  if (patch.status !== undefined) record.status = patch.status
  if (patch.notes !== undefined) record.notes = patch.notes
  if (patch.assignedTo !== undefined) record.assignedTo = patch.assignedTo
  if (patch.votes !== undefined) record.votes = patch.votes
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

// Export for testing
export function _clearFeedbackStore(): void {
  feedbackStore.clear()
  rateLimits.clear()
}
