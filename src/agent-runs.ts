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

export const VALID_RUN_STATUSES: AgentRunStatus[] = [
  'idle', 'working', 'blocked', 'waiting_review', 'completed', 'failed', 'cancelled',
]

export const VALID_EVENT_TYPES = [
  'run_created',
  'task_attached',
  'tool_invoked',
  'artifact_produced',
  'review_requested',
  'review_approved',
  'review_rejected',
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
  opts?: { status?: AgentRunStatus; limit?: number },
): AgentRun[] {
  const db = getDb()
  const limit = opts?.limit ?? 50

  let sql = 'SELECT * FROM agent_runs WHERE agent_id = ? AND team_id = ?'
  const params: unknown[] = [agentId, teamId]

  if (opts?.status) {
    sql += ' AND status = ?'
    params.push(opts.status)
  }

  sql += ' ORDER BY started_at DESC LIMIT ?'
  params.push(limit)

  const rows = db.prepare(sql).all(...params) as RunRow[]
  return rows.map(rowToRun)
}

// ── Events (append-only) ──────────────────────────────────────────────────

export function appendAgentEvent(event: {
  agentId: string
  runId?: string | null
  eventType: string
  payload?: Record<string, unknown>
}): AgentEvent {
  const db = getDb()
  const id = generateEventId()
  const now = Date.now()
  const payload = event.payload ?? {}

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
