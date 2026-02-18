// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Audit Ledger — Immutable log for review-field mutations.
 * 
 * Records every change to reviewer-related fields on tasks:
 * reviewer, reviewer_approved, review_state, approved_by, status (when entering/leaving validating)
 * 
 * Each entry captures: timestamp, taskId, actor, field, before, after.
 * Stored append-only in JSONL for tamper-evidence.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const DATA_DIR = process.env.REFLECTT_DATA_DIR || path.join(process.cwd(), 'data')
const AUDIT_FILE = path.join(DATA_DIR, 'review-audit-ledger.jsonl')

export interface AuditEntry {
  timestamp: number
  taskId: string
  actor: string
  field: string
  before: unknown
  after: unknown
  context?: string // e.g. 'PATCH /tasks/:id', 'POST /tasks/:id/review'
}

/** In-memory index for fast retrieval (also persisted to JSONL) */
const entries: AuditEntry[] = []

/** Maximum entries to keep in memory (older entries are still on disk) */
const MAX_IN_MEMORY = 5000

/**
 * Record a review-field mutation.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  entries.push(entry)
  if (entries.length > MAX_IN_MEMORY) {
    entries.splice(0, entries.length - MAX_IN_MEMORY)
  }

  // Append to JSONL file (best-effort, don't block)
  try {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf-8')
  } catch (err) {
    console.error('[Audit] Failed to write audit entry:', err)
  }
}

/**
 * Record multiple field changes from a single mutation.
 */
export async function recordReviewMutation(opts: {
  taskId: string
  actor: string
  context: string
  changes: Array<{ field: string; before: unknown; after: unknown }>
}): Promise<void> {
  const now = Date.now()
  for (const change of opts.changes) {
    await recordAudit({
      timestamp: now,
      taskId: opts.taskId,
      actor: opts.actor,
      field: change.field,
      before: change.before,
      after: change.after,
      context: opts.context,
    })
  }
}

/**
 * Detect which review-related fields changed between old and new task states.
 */
export function diffReviewFields(
  oldTask: Record<string, unknown>,
  newTask: Record<string, unknown>,
  oldMeta: Record<string, unknown>,
  newMeta: Record<string, unknown>,
): Array<{ field: string; before: unknown; after: unknown }> {
  const changes: Array<{ field: string; before: unknown; after: unknown }> = []

  // Top-level fields
  const topFields = ['reviewer', 'status'] as const
  for (const field of topFields) {
    const before = oldTask[field]
    const after = newTask[field]
    if (before !== after) {
      // Only log status changes involving 'validating'
      if (field === 'status' && before !== 'validating' && after !== 'validating') continue
      changes.push({ field, before, after })
    }
  }

  // Metadata fields
  const metaFields = [
    'reviewer_approved',
    'review_state',
    'approved_by',
    'approved_at',
    'review_last_activity_at',
    'entered_validating_at',
    'review_delta_note',
    'approval_rejected',
  ] as const

  for (const field of metaFields) {
    const before = oldMeta[field]
    const after = newMeta[field]
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push({ field: `metadata.${field}`, before, after })
    }
  }

  return changes
}

/**
 * Get audit entries for a specific task.
 */
export function getAuditForTask(taskId: string): AuditEntry[] {
  return entries.filter(e => e.taskId === taskId)
}

/**
 * Get all audit entries (most recent first), with optional limit.
 */
export function getAuditEntries(opts?: { limit?: number; taskId?: string }): AuditEntry[] {
  let result = opts?.taskId
    ? entries.filter(e => e.taskId === opts.taskId)
    : [...entries]
  result.reverse() // Most recent first
  if (opts?.limit) result = result.slice(0, opts.limit)
  return result
}

/**
 * Load audit entries from disk on startup.
 */
export async function loadAuditLedger(): Promise<number> {
  try {
    const content = await fs.readFile(AUDIT_FILE, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as AuditEntry
        entries.push(entry)
      } catch {
        // Skip malformed lines
      }
    }
    // Keep only recent entries in memory
    if (entries.length > MAX_IN_MEMORY) {
      entries.splice(0, entries.length - MAX_IN_MEMORY)
    }
    return entries.length
  } catch {
    // File doesn't exist yet — that's fine
    return 0
  }
}
