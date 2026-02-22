// SPDX-License-Identifier: Apache-2.0
// Routing Override Lifecycle — role-aware routing hardening
//
// Manages temporary routing overrides with strict lifecycle:
//   active → override_expired → mismatch_blocked
//
// Each override has:
//   - An explicit expiry time (override_expires_at)
//   - A recheck time (override_recheck_at < override_expires_at)
//   - Policy version + request/correlation IDs for auditability
//   - Deterministic state transitions with audit event IDs

import { getDb, safeJsonStringify, safeJsonParse } from './db.js'
import { eventBus } from './events.js'
import { policyManager } from './policy.js'

// ── Types ──

export type OverrideStatus = 'active' | 'override_expired' | 'mismatch_blocked'

export interface RoutingOverride {
  id: string
  /** Agent or role the override applies to */
  target: string
  /** Target type: 'agent' or 'role' */
  target_type: 'agent' | 'role'
  /** Original routing channel */
  original_channel: string
  /** Override routing channel */
  override_channel: string
  /** Reason for the override */
  reason: string
  /** Who created the override */
  created_by: string
  /** Override status lifecycle */
  status: OverrideStatus
  /** When override expires (must be > recheck_at) */
  override_expires_at: number
  /** When to recheck override validity */
  override_recheck_at: number
  /** Policy version at creation time */
  policy_version: string
  /** Request ID for traceability */
  request_id: string
  /** Correlation ID for grouping related overrides */
  correlation_id: string
  /** Audit event IDs for lifecycle transitions */
  audit_event_ids: string[]
  /** Optional metadata */
  metadata?: Record<string, unknown>
  created_at: number
  updated_at: number
}

export interface CreateOverrideInput {
  target: string
  target_type: 'agent' | 'role'
  original_channel: string
  override_channel: string
  reason: string
  created_by: string
  override_expires_at: number
  override_recheck_at: number
  request_id?: string
  correlation_id?: string
  metadata?: Record<string, unknown>
}

export interface OverrideValidation {
  valid: boolean
  errors: string[]
}

export interface OverrideTransitionResult {
  override_id: string
  previous_status: OverrideStatus
  new_status: OverrideStatus
  audit_event_id: string
  timestamp: number
}

// ── Table ──

export function ensureOverrideTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS routing_overrides (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('agent', 'role')),
      original_channel TEXT NOT NULL,
      override_channel TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'override_expired', 'mismatch_blocked')),
      override_expires_at INTEGER NOT NULL,
      override_recheck_at INTEGER NOT NULL,
      policy_version TEXT NOT NULL,
      request_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      audit_event_ids TEXT NOT NULL DEFAULT '[]',
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_routing_overrides_target ON routing_overrides(target, target_type);
    CREATE INDEX IF NOT EXISTS idx_routing_overrides_status ON routing_overrides(status);
    CREATE INDEX IF NOT EXISTS idx_routing_overrides_expires ON routing_overrides(override_expires_at);
  `)
}

// ── Helpers ──

function generateId(): string {
  return `rovr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function generateEventId(): string {
  return `revt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function generateRequestId(): string {
  return `rreq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function generateCorrelationId(): string {
  return `rcor-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function getPolicyVersion(): string {
  try {
    const policy = policyManager.get()
    return (policy as any).version || (policy as any).policyVersion || `v-${Date.now()}`
  } catch {
    return `v-${Date.now()}`
  }
}

// ── Validation ──

/**
 * Validate override creation input.
 * Key rule: override_recheck_at must be strictly less than override_expires_at
 */
export function validateOverrideInput(input: CreateOverrideInput): OverrideValidation {
  const errors: string[] = []

  if (!input.target?.trim()) errors.push('target is required')
  if (!['agent', 'role'].includes(input.target_type)) errors.push('target_type must be "agent" or "role"')
  if (!input.original_channel?.trim()) errors.push('original_channel is required')
  if (!input.override_channel?.trim()) errors.push('override_channel is required')
  if (!input.reason?.trim()) errors.push('reason is required')
  if (!input.created_by?.trim()) errors.push('created_by is required')

  if (typeof input.override_expires_at !== 'number' || input.override_expires_at <= Date.now()) {
    errors.push('override_expires_at must be a future timestamp')
  }
  if (typeof input.override_recheck_at !== 'number' || input.override_recheck_at <= Date.now()) {
    errors.push('override_recheck_at must be a future timestamp')
  }

  // Critical validation: recheck must be before expiry
  if (input.override_recheck_at >= input.override_expires_at) {
    errors.push('override_recheck_at must be strictly less than override_expires_at')
  }

  return { valid: errors.length === 0, errors }
}

// ── CRUD ──

/**
 * Create a routing override with full audit trail.
 */
export function createOverride(input: CreateOverrideInput): RoutingOverride {
  ensureOverrideTable()
  const db = getDb()
  const now = Date.now()
  const id = generateId()
  const eventId = generateEventId()
  const requestId = input.request_id || generateRequestId()
  const correlationId = input.correlation_id || generateCorrelationId()
  const policyVersion = getPolicyVersion()

  const override: RoutingOverride = {
    id,
    target: input.target.trim(),
    target_type: input.target_type,
    original_channel: input.original_channel.trim(),
    override_channel: input.override_channel.trim(),
    reason: input.reason.trim(),
    created_by: input.created_by.trim(),
    status: 'active',
    override_expires_at: input.override_expires_at,
    override_recheck_at: input.override_recheck_at,
    policy_version: policyVersion,
    request_id: requestId,
    correlation_id: correlationId,
    audit_event_ids: [eventId],
    metadata: input.metadata,
    created_at: now,
    updated_at: now,
  }

  db.prepare(`
    INSERT INTO routing_overrides (
      id, target, target_type, original_channel, override_channel,
      reason, created_by, status, override_expires_at, override_recheck_at,
      policy_version, request_id, correlation_id, audit_event_ids,
      metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, override.target, override.target_type,
    override.original_channel, override.override_channel,
    override.reason, override.created_by, override.status,
    override.override_expires_at, override.override_recheck_at,
    policyVersion, requestId, correlationId,
    safeJsonStringify(override.audit_event_ids),
    safeJsonStringify(override.metadata),
    now, now,
  )

  eventBus.emit({
    id: eventId,
    type: 'task_created' as const,
    timestamp: now,
    data: {
      kind: 'routing_override:created',
      override_id: id,
      target: override.target,
      policy_version: policyVersion,
      request_id: requestId,
      correlation_id: correlationId,
    },
  })

  return override
}

export function getOverride(id: string): RoutingOverride | null {
  ensureOverrideTable()
  const db = getDb()
  const row = db.prepare('SELECT * FROM routing_overrides WHERE id = ?').get(id) as any
  return row ? rowToOverride(row) : null
}

export function listOverrides(opts: {
  target?: string
  target_type?: string
  status?: OverrideStatus
  limit?: number
} = {}): RoutingOverride[] {
  ensureOverrideTable()
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []

  if (opts.target) { where.push('target = ?'); params.push(opts.target) }
  if (opts.target_type) { where.push('target_type = ?'); params.push(opts.target_type) }
  if (opts.status) { where.push('status = ?'); params.push(opts.status) }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.min(opts.limit ?? 50, 200)

  const rows = db.prepare(
    `SELECT * FROM routing_overrides ${whereClause} ORDER BY created_at DESC LIMIT ?`
  ).all(...params, limit) as any[]

  return rows.map(rowToOverride)
}

/**
 * Find active override for a target (agent or role).
 */
export function findActiveOverride(target: string, targetType: 'agent' | 'role'): RoutingOverride | null {
  ensureOverrideTable()
  const db = getDb()
  const row = db.prepare(
    `SELECT * FROM routing_overrides WHERE target = ? AND target_type = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`
  ).get(target, targetType) as any
  return row ? rowToOverride(row) : null
}

// ── Lifecycle Transitions ──

/**
 * Tick all active overrides: expire those past their expiry time.
 *
 * Lifecycle:
 *   active → override_expired (when now >= override_expires_at)
 *   override_expired → mismatch_blocked (deterministic second transition)
 *
 * Each transition generates a unique audit event ID.
 */
export function tickOverrideLifecycle(now = Date.now()): {
  expired: OverrideTransitionResult[]
  blocked: OverrideTransitionResult[]
} {
  ensureOverrideTable()
  const db = getDb()
  const expired: OverrideTransitionResult[] = []
  const blocked: OverrideTransitionResult[] = []

  // Phase 1: active → override_expired
  const activeRows = db.prepare(
    `SELECT * FROM routing_overrides WHERE status = 'active' AND override_expires_at <= ?`
  ).all(now) as any[]

  for (const row of activeRows) {
    const override = rowToOverride(row)
    const result = transitionOverride(override, 'override_expired', now)
    if (result) expired.push(result)
  }

  // Phase 2: override_expired → mismatch_blocked (deterministic)
  // All expired overrides immediately transition to mismatch_blocked
  const expiredRows = db.prepare(
    `SELECT * FROM routing_overrides WHERE status = 'override_expired'`
  ).all() as any[]

  for (const row of expiredRows) {
    const override = rowToOverride(row)
    const result = transitionOverride(override, 'mismatch_blocked', now)
    if (result) blocked.push(result)
  }

  return { expired, blocked }
}

/**
 * Transition an override to a new status with audit trail.
 */
function transitionOverride(
  override: RoutingOverride,
  newStatus: OverrideStatus,
  now: number,
): OverrideTransitionResult | null {
  const db = getDb()
  const eventId = generateEventId()
  const previousStatus = override.status

  const updatedEventIds = [...override.audit_event_ids, eventId]

  db.prepare(`
    UPDATE routing_overrides SET
      status = ?, audit_event_ids = ?, updated_at = ?
    WHERE id = ?
  `).run(newStatus, safeJsonStringify(updatedEventIds), now, override.id)

  eventBus.emit({
    id: eventId,
    type: 'task_updated' as const,
    timestamp: now,
    data: {
      kind: `routing_override:${newStatus}`,
      override_id: override.id,
      previous_status: previousStatus,
      new_status: newStatus,
      target: override.target,
      policy_version: override.policy_version,
      request_id: override.request_id,
      correlation_id: override.correlation_id,
    },
  })

  return {
    override_id: override.id,
    previous_status: previousStatus,
    new_status: newStatus,
    audit_event_id: eventId,
    timestamp: now,
  }
}

// ── Row mapping ──

function rowToOverride(row: any): RoutingOverride {
  return {
    id: row.id,
    target: row.target,
    target_type: row.target_type,
    original_channel: row.original_channel,
    override_channel: row.override_channel,
    reason: row.reason,
    created_by: row.created_by,
    status: row.status as OverrideStatus,
    override_expires_at: row.override_expires_at,
    override_recheck_at: row.override_recheck_at,
    policy_version: row.policy_version,
    request_id: row.request_id,
    correlation_id: row.correlation_id,
    audit_event_ids: safeJsonParse<string[]>(row.audit_event_ids) ?? [],
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// ── Test helpers ──

export function _clearOverrides(): void {
  try {
    const db = getDb()
    db.prepare('DELETE FROM routing_overrides').run()
  } catch {
    // Table may not exist
  }
}
