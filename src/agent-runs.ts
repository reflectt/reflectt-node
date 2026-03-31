// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Agent Runs & Events
 *
 * Durable agent work sessions with append-only event log.
 * - agent_runs: tracks objective, status, artifacts, context
 * - agent_events: immutable event stream (no updates, no deletes)
 *
 * Task: task-1773246466959-qxwos0ffp
 */

import { getDb, safeJsonParse } from './db.js'

// ── Types ──────────────────────────────────────────────────────────────────

export type AgentRunStatus =
  | 'idle'
  | 'working'
  | 'blocked'
  | 'waiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'archived'

export const VALID_RUN_STATUSES: AgentRunStatus[] = [
  'idle', 'working', 'blocked', 'waiting_review', 'completed', 'failed', 'cancelled', 'archived',
]

export const VALID_EVENT_TYPES = [
  'run_created',
  'task_attached',
  'tool_invoked',
  'artifact_produced',
  'review_requested',
  'review_approved',
  'review_rejected',
  'approval_requested',
  'approval_approved',
  'approval_rejected',
  'blocked',
  'handed_off',
  'completed',
  'failed',
] as const

export type AgentEventType = (typeof VALID_EVENT_TYPES)[number]

export interface AgentRun {
  id: string
  agentId: string
  teamId: string
  objective: string
  status: AgentRunStatus
  parentRunId: string | null
  contextSnapshot: Record<string, unknown>
  artifacts: Array<Record<string, unknown>>
  startedAt: number
  updatedAt: number
  completedAt: number | null
}

export interface EventRationale {
  choice: string
  considered?: string[]
  constraint?: string
}

export interface AgentEvent {
  id: string
  runId: string | null
  agentId: string
  eventType: AgentEventType
  payload: Record<string, unknown>
  createdAt: number
}

// ── ID generation ──────────────────────────────────────────────────────────

function generateRunId(): string {
  return `arun-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

function generateEventId(): string {
  return `aevt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// ── Row mapping ────────────────────────────────────────────────────────────

interface RunRow {
  id: string
  agent_id: string
  team_id: string
  objective: string
  status: string
  parent_run_id: string | null
  context_snapshot: string
  artifacts: string
  started_at: number
  updated_at: number
  completed_at: number | null
}

interface EventRow {
  id: string
  run_id: string | null
  agent_id: string
  event_type: string
  payload: string
  created_at: number
}

function rowToRun(row: RunRow): AgentRun {
  return {
    id: row.id,
    agentId: row.agent_id,
    teamId: row.team_id,
    objective: row.objective,
    status: row.status as AgentRunStatus,
    parentRunId: row.parent_run_id,
    contextSnapshot: safeJsonParse<Record<string, unknown>>(row.context_snapshot) ?? {},
    artifacts: safeJsonParse<Array<Record<string, unknown>>>(row.artifacts) ?? [],
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

function rowToEvent(row: EventRow): AgentEvent {
  return {
    id: row.id,
    runId: row.run_id,
    agentId: row.agent_id,
    eventType: row.event_type as AgentEventType,
    payload: safeJsonParse<Record<string, unknown>>(row.payload) ?? {},
    createdAt: row.created_at,
  }
}

function isDecisionEventType(eventType: string): boolean {
  return ['review_requested', 'review_approved', 'review_rejected', 'handed_off'].includes(eventType)
}

export function validateRationale(rationale: unknown): EventRationale {
  if (!rationale || typeof rationale !== 'object' || Array.isArray(rationale)) {
    throw new Error('rationale must be an object with choice, considered[], constraint')
  }
  const r = rationale as Record<string, unknown>
  if (typeof r.choice !== 'string' || r.choice.trim().length === 0) {
    throw new Error('rationale.choice is required')
  }
  if (r.considered !== undefined) {
    if (!Array.isArray(r.considered) || !r.considered.every(v => typeof v === 'string' && v.trim().length > 0)) {
      throw new Error('rationale.considered must be an array of non-empty strings')
    }
  }
  if (r.constraint !== undefined && typeof r.constraint !== 'string') {
    throw new Error('rationale.constraint must be a string')
  }
  return {
    choice: r.choice.trim(),
    ...(r.considered ? { considered: (r.considered as string[]).map(v => v.trim()) } : {}),
    ...(typeof r.constraint === 'string' ? { constraint: r.constraint.trim() } : {}),
  }
}

// ── Runs ───────────────────────────────────────────────────────────────────

export function createAgentRun(
  agentId: string,
  teamId: string,
  objective: string,
  opts?: { taskId?: string; parentRunId?: string },
): AgentRun {
  const db = getDb()
  const now = Date.now()
  const id = generateRunId()

  const contextSnapshot = opts?.taskId ? { taskId: opts.taskId } : {}

  db.prepare(`
    INSERT INTO agent_runs (id, agent_id, team_id, objective, status, parent_run_id, context_snapshot, artifacts, started_at, updated_at)
    VALUES (?, ?, ?, ?, 'idle', ?, ?, '[]', ?, ?)
  `).run(id, agentId, teamId, objective, opts?.parentRunId ?? null, JSON.stringify(contextSnapshot), now, now)

  // Append run_created event
  appendAgentEvent({
    agentId,
    runId: id,
    eventType: 'run_created',
    payload: { objective, taskId: opts?.taskId },
  })

  return {
    id,
    agentId,
    teamId,
    objective,
    status: 'idle',
    parentRunId: opts?.parentRunId ?? null,
    contextSnapshot,
    artifacts: [],
    startedAt: now,
    updatedAt: now,
    completedAt: null,
  }
}

export function updateAgentRun(
  runId: string,
  updates: {
    status?: AgentRunStatus
    contextSnapshot?: Record<string, unknown>
    artifacts?: Array<Record<string, unknown>>
    completedAt?: number
  },
): AgentRun | null {
  const db = getDb()
  const now = Date.now()

  // Validate status if provided
  if (updates.status && !VALID_RUN_STATUSES.includes(updates.status)) {
    throw new Error(`Invalid run status: ${updates.status}`)
  }

  const sets: string[] = ['updated_at = ?']
  const params: unknown[] = [now]

  if (updates.status) {
    sets.push('status = ?')
    params.push(updates.status)
  }
  if (updates.contextSnapshot !== undefined) {
    sets.push('context_snapshot = ?')
    params.push(JSON.stringify(updates.contextSnapshot))
  }
  if (updates.artifacts !== undefined) {
    sets.push('artifacts = ?')
    params.push(JSON.stringify(updates.artifacts))
  }
  if (updates.completedAt !== undefined) {
    sets.push('completed_at = ?')
    params.push(updates.completedAt)
  }
  // Auto-set completed_at for terminal statuses
  if (updates.status && ['completed', 'failed', 'cancelled'].includes(updates.status) && updates.completedAt === undefined) {
    sets.push('completed_at = ?')
    params.push(now)
  }

  params.push(runId)
  const result = db.prepare(`UPDATE agent_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params)

  if (result.changes === 0) return null

  const row = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as RunRow | undefined
  if (!row) return null

  const run = rowToRun(row)

  return run
}

export function getAgentRun(runId: string): AgentRun | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as RunRow | undefined
  return row ? rowToRun(row) : null
}

export function getActiveAgentRun(agentId: string, teamId: string): AgentRun | null {
  const db = getDb()
  const row = db.prepare(
    `SELECT * FROM agent_runs WHERE agent_id = ? AND team_id = ? AND status NOT IN ('completed', 'failed', 'cancelled') ORDER BY started_at DESC LIMIT 1`,
  ).get(agentId, teamId) as RunRow | undefined
  return row ? rowToRun(row) : null
}

export function listAgentRuns(
  agentId: string,
  teamId: string,
  opts?: { status?: AgentRunStatus; limit?: number; includeArchived?: boolean },
): AgentRun[] {
  const db = getDb()
  const limit = opts?.limit ?? 50

  let sql = 'SELECT * FROM agent_runs WHERE agent_id = ? AND team_id = ?'
  const params: unknown[] = [agentId, teamId]

  if (opts?.status) {
    sql += ' AND status = ?'
    params.push(opts.status)
  } else if (!opts?.includeArchived) {
    // Exclude archived runs from default listing
    sql += " AND status != 'archived'"
  }

  sql += ' ORDER BY started_at DESC LIMIT ?'
  params.push(limit)

  const rows = db.prepare(sql).all(...params) as RunRow[]
  return rows.map(rowToRun)
}

// ── Events (append-only) ──────────────────────────────────────────────────

// Routing payload is a narrow API contract for actionable boundary writes.
// Internal/event-specific payloads can still carry richer fields.
export const VALID_ACTION_REQUIRED = ['review', 'unblock', 'approve', 'fyi'] as const
export const VALID_ROUTING_URGENCY = ['blocking', 'normal', 'low'] as const

const ACTIONABLE_EVENT_TYPES = new Set([
  'review_requested',
  'approval_requested',
  'escalation',
  'handoff',
])

const VALID_ACTION_REQUIRED_SET = new Set<string>(VALID_ACTION_REQUIRED)
const VALID_ROUTING_URGENCY_SET = new Set<string>(VALID_ROUTING_URGENCY)

export interface RoutingValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateRoutingSemantics(eventType: string, payload: Record<string, unknown>): RoutingValidation {
  const errors: string[] = []
  const warnings: string[] = []

  const hasRoutingFields = payload.action_required !== undefined
    || payload.urgency !== undefined
    || payload.owner !== undefined
    || payload.expires_at !== undefined

  if (!ACTIONABLE_EVENT_TYPES.has(eventType) && !hasRoutingFields) {
    return { valid: true, errors: [], warnings: [] }
  }

  if (typeof payload.action_required !== 'string' || payload.action_required.trim().length === 0) {
    errors.push(`action_required is required and must be one of: ${VALID_ACTION_REQUIRED.join('|')}`)
  } else if (!VALID_ACTION_REQUIRED_SET.has(payload.action_required.trim())) {
    errors.push(`action_required must be one of: ${VALID_ACTION_REQUIRED.join('|')}`)
  }

  if (typeof payload.urgency !== 'string' || payload.urgency.trim().length === 0) {
    errors.push(`urgency is required and must be one of: ${VALID_ROUTING_URGENCY.join('|')}`)
  } else if (!VALID_ROUTING_URGENCY_SET.has(payload.urgency.trim())) {
    errors.push(`urgency must be one of: ${VALID_ROUTING_URGENCY.join('|')}`)
  }

  if (payload.expires_at !== undefined && typeof payload.expires_at !== 'number') {
    warnings.push('expires_at should be a numeric timestamp (epoch ms)')
  }

  return { valid: errors.length === 0, errors, warnings }
}

export function appendAgentEvent(event: {
  agentId: string
  runId?: string | null
  eventType: string
  payload?: Record<string, unknown>
  enforceRouting?: boolean  // default true for actionable events
}): AgentEvent {
  const db = getDb()
  const id = generateEventId()
  const now = Date.now()
  const payload = { ...(event.payload ?? {}) }

  if (isDecisionEventType(event.eventType)) {
    if (payload.rationale === undefined) {
      throw new Error(`rationale is required for ${event.eventType}`)
    }
    payload.rationale = validateRationale(payload.rationale)
  } else if (payload.rationale !== undefined) {
    payload.rationale = validateRationale(payload.rationale)
  }

  // Enforce routing semantics for actionable events
  const enforce = event.enforceRouting !== false
  if (enforce) {
    const validation = validateRoutingSemantics(event.eventType, payload)
    if (!validation.valid) {
      throw new Error(`Routing semantics violation: ${validation.errors.join('; ')}`)
    }
  }

  db.prepare(`
    INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, event.runId ?? null, event.agentId, event.eventType, JSON.stringify(payload), now)

  return {
    id,
    runId: event.runId ?? null,
    agentId: event.agentId,
    eventType: event.eventType as AgentEventType,
    payload,
    createdAt: now,
  }
}

export function listAgentEvents(opts: {
  agentId?: string
  runId?: string
  eventType?: string
  since?: number
  limit?: number
}): AgentEvent[] {
  const db = getDb()
  const limit = opts.limit ?? 100
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.agentId) {
    conditions.push('agent_id = ?')
    params.push(opts.agentId)
  }
  if (opts.runId) {
    conditions.push('run_id = ?')
    params.push(opts.runId)
  }
  if (opts.eventType) {
    conditions.push('event_type = ?')
    params.push(opts.eventType)
  }
  if (opts.since) {
    conditions.push('created_at >= ?')
    params.push(opts.since)
  }

  let sql = 'SELECT * FROM agent_events'
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ')
  }
  sql += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)

  const rows = db.prepare(sql).all(...params) as EventRow[]
  return rows.map(rowToEvent)
}

// ── Run retention / archive ─────────────────────────────────────────────────

export interface RetentionPolicy {
  maxAgeDays: number          // Archive runs older than this
  maxCompletedRuns: number    // Keep at most this many completed runs per agent
  deleteArchived: boolean     // Actually delete archived runs (vs just marking)
}

const DEFAULT_RETENTION: RetentionPolicy = {
  maxAgeDays: 30,
  maxCompletedRuns: 100,
  deleteArchived: false,
}

export interface RetentionResult {
  archived: number
  deleted: number
  eventsDeleted: number
  dryRun: boolean
}

/**
 * Archive old completed/cancelled/failed runs per retention policy.
 * Returns count of runs archived and events cleaned up.
 */
export function applyRunRetention(opts?: {
  policy?: Partial<RetentionPolicy>
  agentId?: string
  dryRun?: boolean
}): RetentionResult {
  const db = getDb()
  const policy = { ...DEFAULT_RETENTION, ...opts?.policy }
  const dryRun = opts?.dryRun ?? false
  const now = Date.now()
  const cutoffMs = now - policy.maxAgeDays * 24 * 60 * 60 * 1000
  const terminalStatuses = ['completed', 'failed', 'cancelled']

  // Find runs to archive: terminal status + older than cutoff
  let sql = `
    SELECT id, agent_id FROM agent_runs 
    WHERE status IN (${terminalStatuses.map(() => '?').join(',')})
    AND started_at < ?
  `
  const params: unknown[] = [...terminalStatuses, cutoffMs]

  if (opts?.agentId) {
    sql += ' AND agent_id = ?'
    params.push(opts.agentId)
  }
  sql += ' ORDER BY started_at ASC'

  const rows = db.prepare(sql).all(...params) as Array<{ id: string; agent_id: string }>

  if (dryRun) {
    return { archived: rows.length, deleted: 0, eventsDeleted: 0, dryRun: true }
  }

  let archived = 0
  let deleted = 0
  let eventsDeleted = 0

  for (const row of rows) {
    if (policy.deleteArchived) {
      // Delete events first (foreign key-like cleanup)
      const evtResult = db.prepare('DELETE FROM agent_events WHERE run_id = ?').run(row.id)
      eventsDeleted += evtResult.changes
      // Delete the run
      db.prepare('DELETE FROM agent_runs WHERE id = ?').run(row.id)
      deleted++
    } else {
      // Mark as archived (update status)
      db.prepare("UPDATE agent_runs SET status = 'archived', updated_at = ? WHERE id = ?").run(now, row.id)
      archived++
    }
  }

  // Enforce max completed runs per agent — keep newest, archive/delete oldest
  const agentIds = opts?.agentId
    ? [opts.agentId]
    : (db.prepare('SELECT DISTINCT agent_id FROM agent_runs').all() as Array<{ agent_id: string }>).map(r => r.agent_id)

  for (const agentId of agentIds) {
    const completedRuns = db.prepare(`
      SELECT id FROM agent_runs 
      WHERE agent_id = ? AND status IN (${terminalStatuses.map(() => '?').join(',')})
      ORDER BY started_at DESC
    `).all(agentId, ...terminalStatuses) as Array<{ id: string }>

    if (completedRuns.length > policy.maxCompletedRuns) {
      const toRemove = completedRuns.slice(policy.maxCompletedRuns)
      for (const run of toRemove) {
        if (policy.deleteArchived) {
          const evtResult = db.prepare('DELETE FROM agent_events WHERE run_id = ?').run(run.id)
          eventsDeleted += evtResult.changes
          db.prepare('DELETE FROM agent_runs WHERE id = ?').run(run.id)
          deleted++
        } else {
          db.prepare("UPDATE agent_runs SET status = 'archived', updated_at = ? WHERE id = ?").run(now, run.id)
          archived++
        }
      }
    }
  }

  return { archived, deleted, eventsDeleted, dryRun: false }
}

/**
 * Get retention stats — how many runs would be affected by current policy.
 */
export function getRetentionStats(policy?: Partial<RetentionPolicy>): {
  totalRuns: number
  terminalRuns: number
  wouldArchive: number
  oldestRunAge: number | null
} {
  const db = getDb()
  const p = { ...DEFAULT_RETENTION, ...policy }
  const now = Date.now()
  const cutoffMs = now - p.maxAgeDays * 24 * 60 * 60 * 1000

  const totalRuns = (db.prepare('SELECT COUNT(*) as c FROM agent_runs').get() as { c: number }).c
  const terminalRuns = (db.prepare("SELECT COUNT(*) as c FROM agent_runs WHERE status IN ('completed','failed','cancelled')").get() as { c: number }).c
  const wouldArchive = (db.prepare("SELECT COUNT(*) as c FROM agent_runs WHERE status IN ('completed','failed','cancelled') AND started_at < ?").get(cutoffMs) as { c: number }).c
  const oldest = db.prepare('SELECT MIN(started_at) as m FROM agent_runs').get() as { m: number | null }
  const oldestRunAge = oldest.m ? Math.floor((now - oldest.m) / (24 * 60 * 60 * 1000)) : null

  return { totalRuns, terminalRuns, wouldArchive, oldestRunAge }
}

// ── Approval routing ───────────────────────────────────────────────────────

export interface PendingApproval {
  event: AgentEvent
  agentId: string
  runId: string | null
  urgency: string | null
  owner: string | null
  expiresAt: number | null
}

/**
 * List pending approvals: review_requested events with action_required
 * that don't yet have a matching review_approved or review_rejected.
 */
export function listPendingApprovals(opts?: {
  agentId?: string
  limit?: number
}): PendingApproval[] {
  const db = getDb()
  const limit = opts?.limit ?? 50
  const conditions = ["e.event_type = 'review_requested'", "json_extract(e.payload, '$.action_required') IS NOT NULL"]
  const params: unknown[] = []

  if (opts?.agentId) {
    conditions.push('e.agent_id = ?')
    params.push(opts.agentId)
  }

  // Exclude events that already have a resolution (approved/rejected) for the same run
  const sql = `
    SELECT e.* FROM agent_events e
    WHERE ${conditions.join(' AND ')}
    AND NOT EXISTS (
      SELECT 1 FROM agent_events r
      WHERE r.run_id = e.run_id
      AND r.event_type IN ('review_approved', 'review_rejected')
      AND r.created_at > e.created_at
    )
    ORDER BY e.created_at DESC
    LIMIT ?
  `
  params.push(limit)

  const rows = db.prepare(sql).all(...params) as EventRow[]
  return rows.map(row => {
    const event = rowToEvent(row)
    return {
      event,
      agentId: event.agentId,
      runId: event.runId,
      urgency: (event.payload.urgency as string) ?? null,
      owner: (event.payload.owner as string) ?? null,
      expiresAt: (event.payload.expires_at as number) ?? null,
    }
  })
}

/**
 * Submit an approval decision. Records a review_approved or review_rejected event
 * and optionally unblocks the associated run.
 */
/**
 * Dedicated approval queue — unified view of everything needing human decision.
 * Covers review_requested (PR reviews) AND approval_requested (agent actions like deploy/execute).
 * Each item answers: what needs decision, who owns it, when it expires, what happens if ignored.
 */
export interface ApprovalQueueItem {
  id: string
  category: 'review' | 'agent_action'
  event: AgentEvent
  agentId: string
  runId: string | null
  title: string
  description: string | null
  urgency: string | null
  owner: string | null
  expiresAt: number | null
  autoAction: string | null  // what happens if ignored past expiry
  createdAt: number
  isExpired: boolean
}

export function listApprovalQueue(opts?: {
  agentId?: string
  category?: 'review' | 'agent_action'
  includeExpired?: boolean
  limit?: number
}): ApprovalQueueItem[] {
  const db = getDb()
  const limit = opts?.limit ?? 50
  const now = Date.now()
  const eventTypes = ["'review_requested'", "'approval_requested'"]

  if (opts?.category === 'review') {
    eventTypes.length = 0
    eventTypes.push("'review_requested'")
  } else if (opts?.category === 'agent_action') {
    eventTypes.length = 0
    eventTypes.push("'approval_requested'")
  }

  const conditions = [
    `e.event_type IN (${eventTypes.join(', ')})`,
  ]
  const params: unknown[] = []

  if (opts?.agentId) {
    conditions.push('e.agent_id = ?')
    params.push(opts.agentId)
  }

  // Exclude resolved items
  const sql = `
    SELECT e.* FROM agent_events e
    WHERE ${conditions.join(' AND ')}
    AND NOT EXISTS (
      SELECT 1 FROM agent_events r
      WHERE r.run_id = e.run_id
      AND r.event_type IN ('review_approved', 'review_rejected', 'approval_approved', 'approval_rejected')
      AND r.created_at > e.created_at
    )
    ORDER BY e.created_at DESC
    LIMIT ?
  `
  params.push(limit)

  const rows = db.prepare(sql).all(...params) as EventRow[]
  const items = rows.map(row => {
    const event = rowToEvent(row)
    const expiresAt = (event.payload.expires_at as number) ?? null
    const isExpired = expiresAt !== null && expiresAt < now
    return {
      id: event.id,
      category: (event.eventType === 'review_requested' ? 'review' : 'agent_action') as 'review' | 'agent_action',
      event,
      agentId: event.agentId,
      runId: event.runId,
      title: (event.payload.title as string) ?? (event.payload.action_required as string) ?? 'Pending approval',
      description: (event.payload.description as string) ?? (event.payload.context as string) ?? null,
      urgency: (event.payload.urgency as string) ?? null,
      owner: (event.payload.owner as string) ?? null,
      expiresAt,
      autoAction: (event.payload.auto_action as string) ?? null,
      createdAt: event.createdAt,
      isExpired,
    }
  })

  if (!opts?.includeExpired) {
    return items.filter(i => !i.isExpired)
  }
  return items
}

/**
 * Notify a reviewer via their agent run when a task enters validating.
 * Gets or creates the reviewer's current run, appends a review_requested
 * event, and sets the run status to waiting_review.
 *
 * Task: task-review-run-wire
 */
export function notifyReviewerViaRun(task: {
  id: string
  title: string
  reviewer: string
  assignee?: string | null
  metadata?: Record<string, unknown>
  teamId?: string | null
}): AgentRun {
  const teamId = task.teamId ?? 'default'

  // Get or create reviewer's current run
  let run = getActiveAgentRun(task.reviewer, teamId)
  if (!run) {
    run = createAgentRun(task.reviewer, teamId, 'pending reviews')
  }

  // Extract pr_url from metadata
  const meta = task.metadata ?? {}
  const prUrl = (meta.pr_url as string | undefined)
    ?? ((meta.review_handoff as Record<string, unknown> | undefined)?.pr_url as string | undefined)
    ?? ((meta.qa_bundle as Record<string, unknown> | undefined)?.pr_url as string | undefined)
    ?? null

  // Extract qa_bundle summary
  const qaBundle = meta.qa_bundle as Record<string, unknown> | undefined
  const qaBundleSummary = ((qaBundle?.summary ?? qaBundle?.description) as string | undefined) ?? null

  // Append review_requested event to reviewer's run
  appendAgentEvent({
    agentId: task.reviewer,
    runId: run.id,
    eventType: 'review_requested',
    payload: {
      task_id: task.id,
      task_title: task.title,
      pr_url: prUrl,
      assignee: task.assignee ?? null,
      action_required: 'review',
      urgency: 'normal',
      qa_bundle_summary: qaBundleSummary,
      rationale: {
        choice: `Review requested for task ${task.id}: ${task.title}`,
      },
    },
  })

  // Set run to waiting_review
  const updated = updateAgentRun(run.id, { status: 'waiting_review' })
  return updated ?? run
}

export function submitApprovalDecision(opts: {
  eventId: string
  decision: 'approve' | 'reject'
  reviewer: string
  comment?: string
  rationale?: EventRationale
}): { event: AgentEvent; runUnblocked: boolean } {
  const db = getDb()

  // Find the original review_requested OR approval_requested event
  const originalRow = db.prepare('SELECT * FROM agent_events WHERE id = ?').get(opts.eventId) as EventRow | undefined
  if (!originalRow) throw new Error(`Event ${opts.eventId} not found`)
  const original = rowToEvent(originalRow)
  if (original.eventType !== 'review_requested' && original.eventType !== 'approval_requested') {
    throw new Error(`Event ${opts.eventId} is type ${original.eventType}, expected review_requested or approval_requested`)
  }

  // Record the decision — use the matching *_approved/*_rejected event type
  const isReview = original.eventType === 'review_requested'
  const eventType = isReview
    ? (opts.decision === 'approve' ? 'review_approved' : 'review_rejected')
    : (opts.decision === 'approve' ? 'approval_approved' : 'approval_rejected')
  const decisionEvent = appendAgentEvent({
    agentId: original.agentId,
    runId: original.runId,
    eventType,
    payload: {
      original_event_id: opts.eventId,
      reviewer: opts.reviewer,
      ...(opts.comment ? { comment: opts.comment } : {}),
      rationale: opts.rationale,
    },
  })

  // Auto-unblock: if approved and run exists in waiting_review, move to working
  let runUnblocked = false
  if (opts.decision === 'approve' && original.runId) {
    const run = getAgentRun(original.runId)
    if (run && run.status === 'waiting_review') {
      updateAgentRun(original.runId, { status: 'working' })
      runUnblocked = true
    }
  }

  return { event: decisionEvent, runUnblocked }
}

/**
 * Sweep expired approval/review cards on node startup.
 *
 * Approval and review cards older than TTL (default 24h) that have no decision event
 * are pruned by inserting a synthetic `approval_rejected`/`review_rejected` event with
 * actor="system" and reason="expired". This prevents stale cards from reappearing after
 * node restarts and ensures the canvas approval queue stays clean.
 *
 * AC: task-1773603042171-oqcsfar7m
 */
export function sweepExpiredApprovalCards(ttlMs: number = 24 * 60 * 60 * 1000): number {
  const db = getDb()
  const cutoff = Date.now() - ttlMs

  // Find undecided approval_requested and review_requested events older than TTL
  const staleRows = db.prepare(`
    SELECT e.* FROM agent_events e
    WHERE e.event_type IN ('approval_requested', 'review_requested')
    AND e.created_at < ?
    AND NOT EXISTS (
      SELECT 1 FROM agent_events r
      WHERE r.run_id = e.run_id
      AND r.event_type IN ('review_approved', 'review_rejected', 'approval_approved', 'approval_rejected')
      AND r.created_at > e.created_at
    )
    ORDER BY e.created_at ASC
  `).all(cutoff) as EventRow[]

  let pruned = 0
  for (const row of staleRows) {
    try {
      const original = rowToEvent(row)
      const expiredEventType = original.eventType === 'review_requested' ? 'review_rejected' : 'approval_rejected'
      appendAgentEvent({
        agentId: original.agentId,
        runId: original.runId,
        eventType: expiredEventType,
        payload: {
          original_event_id: original.id,
          reviewer: 'system',
          reason: 'expired',
          expired_at: Date.now(),
          ttl_ms: ttlMs,
        },
      })
      pruned++
    } catch {
      // Non-fatal — skip individual failures
    }
  }

  if (pruned > 0) {
    console.log(`[ApprovalSweep] Pruned ${pruned} expired approval/review card${pruned > 1 ? 's' : ''} (TTL: ${ttlMs / 3600000}h)`)
  }
  return pruned
}
