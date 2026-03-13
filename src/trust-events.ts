/**
 * trust-events.ts — Trust-collapse signal ledger
 *
 * Records trust events to local SQLite and syncs them to cloud via
 * POST /api/hosts/:hostId/trust-events/sync
 *
 * Taxonomy v1:
 *   false_assertion         — agent claims something untrue as fact
 *   stale_status_claim      — agent/host claims active state when evidence shows otherwise
 *   self_review_violation   — reviewer === assignee on a task
 *   missing_acceptance_criteria_block — task moved to done without done_criteria
 *   escalation_bypass       — task jumped states illegally (e.g. todo→done skipping doing/validating)
 *
 * Severity:
 *   warning  — notable, worth tracking
 *   critical — reviewer or process integrity at risk
 */

import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

let _db: InstanceType<typeof Database> | null = null

function getDb(): InstanceType<typeof Database> {
  if (_db) return _db
  const dataDir = process.env.REFLECTT_DATA_DIR || join(process.env.HOME || '', '.reflectt')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  _db = new Database(join(dataDir, 'trust_events.db'))
  _db.pragma('journal_mode = WAL')
  ensureTables(_db)
  return _db
}

function ensureTables(db: InstanceType<typeof Database>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trust_events (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'warning',
      task_id TEXT,
      summary TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '{}',
      synced INTEGER NOT NULL DEFAULT 0,
      occurred_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trust_events_synced ON trust_events(synced, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_trust_events_type ON trust_events(event_type, occurred_at);
  `)
}

export type TrustEventType =
  | 'false_assertion'
  | 'stale_status_claim'
  | 'self_review_violation'
  | 'missing_acceptance_criteria_block'
  | 'escalation_bypass'

export interface TrustEvent {
  id: string
  agentId: string
  eventType: TrustEventType
  severity: 'warning' | 'critical'
  taskId?: string | null
  summary?: string
  context: Record<string, unknown>
  occurredAt: number
}

const SEVERITY_MAP: Record<TrustEventType, 'warning' | 'critical'> = {
  false_assertion: 'critical',
  self_review_violation: 'critical',
  stale_status_claim: 'warning',
  missing_acceptance_criteria_block: 'warning',
  escalation_bypass: 'warning',
}

/**
 * Record a trust event locally.
 */
export function emitTrustEvent(input: {
  agentId: string
  eventType: TrustEventType
  severity?: 'warning' | 'critical'
  taskId?: string | null
  summary?: string
  context?: Record<string, unknown>
}): TrustEvent {
  const db = getDb()
  const record: TrustEvent = {
    id: `te-${Date.now()}-${randomUUID().slice(0, 8)}`,
    agentId: input.agentId,
    eventType: input.eventType,
    severity: input.severity ?? SEVERITY_MAP[input.eventType] ?? 'warning',
    taskId: input.taskId ?? null,
    summary: input.summary ?? input.eventType.replace(/_/g, ' '),
    context: input.context ?? {},
    occurredAt: Date.now(),
  }
  db.prepare(`
    INSERT OR IGNORE INTO trust_events
      (id, agent_id, event_type, severity, task_id, summary, context, synced, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    record.id, record.agentId, record.eventType, record.severity,
    record.taskId ?? null, record.summary, JSON.stringify(record.context),
    record.occurredAt
  )
  return record
}

/**
 * Get unsynced events for cloud push (does NOT mark as synced — caller must markTrustEventsPushed).
 */
export function getUnpushedTrustEvents(limit = 50): TrustEvent[] {
  const db = getDb()
  const rows = db.prepare(
    `SELECT * FROM trust_events WHERE synced = 0 ORDER BY occurred_at ASC LIMIT ?`
  ).all(limit) as any[]

  return rows.map(r => ({
    id: r.id,
    agentId: r.agent_id,
    eventType: r.event_type as TrustEventType,
    severity: r.severity as 'warning' | 'critical',
    taskId: r.task_id ?? null,
    summary: r.summary,
    context: JSON.parse(r.context || '{}'),
    occurredAt: r.occurred_at,
  }))
}

/**
 * Mark events as synced after successful cloud push.
 */
export function markTrustEventsPushed(ids: string[]): void {
  if (ids.length === 0) return
  const db = getDb()
  db.prepare(
    `UPDATE trust_events SET synced = 1 WHERE id IN (${ids.map(() => '?').join(',')})`
  ).run(...ids)
}

/**
 * Mark events as unsynced (retry after cloud push failure).
 */
export function markTrustEventsUnsynced(ids: string[]): void {
  if (ids.length === 0) return
  const db = getDb()
  db.prepare(
    `UPDATE trust_events SET synced = 0 WHERE id IN (${ids.map(() => '?').join(',')})`
  ).run(...ids)
}

/**
 * List trust events for diagnostics / GET /trust-events endpoint.
 */
export function listTrustEvents(opts?: {
  agentId?: string
  eventType?: TrustEventType
  since?: number
  limit?: number
}): TrustEvent[] {
  const db = getDb()
  const conditions: string[] = []
  const params: unknown[] = []
  if (opts?.agentId) { conditions.push('agent_id = ?'); params.push(opts.agentId) }
  if (opts?.eventType) { conditions.push('event_type = ?'); params.push(opts.eventType) }
  if (opts?.since) { conditions.push('occurred_at >= ?'); params.push(opts.since) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = opts?.limit ?? 50
  const rows = db.prepare(
    `SELECT * FROM trust_events ${where} ORDER BY occurred_at DESC LIMIT ?`
  ).all(...params, limit) as any[]
  return rows.map(r => ({
    id: r.id,
    agentId: r.agent_id,
    eventType: r.event_type as TrustEventType,
    severity: r.severity as 'warning' | 'critical',
    taskId: r.task_id ?? null,
    summary: r.summary,
    context: JSON.parse(r.context || '{}'),
    occurredAt: r.occurred_at,
  }))
}
