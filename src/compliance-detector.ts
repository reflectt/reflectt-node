// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Session Compliance Detector
 *
 * Implements the state-read-before-assertion rule:
 * Every triggering action (task create, status transition, review, reflection)
 * must be preceded by at least one qualifying state read within the session window.
 *
 * Based on: docs/compliance-spec-state-reads.md
 * Task: task-1772609696194-1i9s775yl
 *
 * Phase 1: API-layer triggers only.
 * Phase 2 (future): chat assertion detection.
 *
 * Flag, do not block. Observability-first.
 */

import { getDb } from './db.js'

// ── Constants ──────────────────────────────────────────────────────────────

/** Normal session window (ms) */
const WINDOW_NORMAL_MS = 10 * 60 * 1000

/** Long-running task session window (ms) */
const WINDOW_LONG_MS = 30 * 60 * 1000

/** Heartbeat-triggered session window (ms) */
const WINDOW_HEARTBEAT_MS = 5 * 60 * 1000

// ── Types ──────────────────────────────────────────────────────────────────

export type ViolationSeverity = 'high' | 'medium' | 'low'
export type ViolationType =
  | 'no_state_read_before_action'   // zero reads in session
  | 'stale_state_read'              // reads exist but window expired

export interface ComplianceViolation {
  id: string
  agent: string
  session_id: string
  violation_type: ViolationType
  severity: ViolationSeverity
  triggering_call: string
  last_state_read_at: number | null
  window_elapsed_ms: number | null
  window_used_ms: number
  detected_at: number
}

// ── In-memory session state ────────────────────────────────────────────────

interface SessionState {
  lastStateReadAt: number | null
  /** true if the most recent state read was a heartbeat call */
  lastReadWasHeartbeat: boolean
  /** true if the session has any active doing task (use long window) */
  hasActiveTask: boolean
}

// Sessions keyed by: `${agent}:${bucketId}` where bucketId is 30-min bucket
const sessions = new Map<string, SessionState>()

function getBucketId(now: number): string {
  // 30-minute buckets
  return String(Math.floor(now / WINDOW_LONG_MS))
}

function getSessionKey(agent: string, now: number): string {
  return `${agent.toLowerCase()}:${getBucketId(now)}`
}

function getOrCreateSession(agent: string, now: number): SessionState {
  const key = getSessionKey(agent, now)
  if (!sessions.has(key)) {
    // Carry forward the most recent state read from the previous bucket,
    // so reads near a bucket boundary don't lose their validity window.
    const prevKey = `${agent.toLowerCase()}:${String(Number(getBucketId(now)) - 1)}`
    const prev = sessions.get(prevKey)
    sessions.set(key, {
      lastStateReadAt: prev?.lastStateReadAt ?? null,
      lastReadWasHeartbeat: prev?.lastReadWasHeartbeat ?? false,
      hasActiveTask: prev?.hasActiveTask ?? false,
    })
  }
  // Clean stale sessions (older than 2 buckets)
  cleanStaleSessions(now)
  return sessions.get(key)!
}

function cleanStaleSessions(now: number): void {
  const currentBucket = getBucketId(now)
  const prevBucket = String(Number(currentBucket) - 1)
  for (const key of sessions.keys()) {
    const bucket = key.split(':')[1]
    if (bucket !== currentBucket && bucket !== prevBucket) {
      sessions.delete(key)
    }
  }
}

// ── State read registry ────────────────────────────────────────────────────

/** URL patterns that count as qualifying state reads */
const STATE_READ_PATTERNS: Array<{
  pattern: RegExp
  isHeartbeat: boolean
}> = [
  { pattern: /^GET \/heartbeat\/[^/]+$/, isHeartbeat: true },
  { pattern: /^GET \/tasks\/active($|\?)/, isHeartbeat: false },
  { pattern: /^GET \/tasks\/next($|\?)/, isHeartbeat: false },
  { pattern: /^GET \/tasks($|\?)/, isHeartbeat: false },
  { pattern: /^GET \/tasks\/[^/]+($|\?)/, isHeartbeat: false },
  { pattern: /^GET \/chat\/messages($|\?)/, isHeartbeat: false },
  { pattern: /^GET \/inbox\/[^/]+($|\?)/, isHeartbeat: false },
  { pattern: /^GET \/me\/[^/]+($|\?)/, isHeartbeat: false },
]

/** URL + method patterns that count as triggering actions */
const TRIGGERING_PATTERNS: Array<{
  pattern: RegExp
  label: string
}> = [
  { pattern: /^POST \/tasks($|\?)/, label: 'POST /tasks' },
  { pattern: /^PATCH \/tasks\/[^/]+($|\?)/, label: 'PATCH /tasks/:id' },
  { pattern: /^POST \/tasks\/[^/]+\/review($|\?)/, label: 'POST /tasks/:id/review' },
  { pattern: /^POST \/reflections($|\?)/, label: 'POST /reflections' },
  // Note: POST /tasks/:id/comments is NOT a Phase 1 trigger.
  // Phase 2 will add chat assertion detection for comments with status claims.
]

function isStateRead(method: string, path: string): { isRead: boolean; isHeartbeat: boolean } {
  const key = `${method.toUpperCase()} ${path.split('?')[0]}`
  for (const { pattern, isHeartbeat } of STATE_READ_PATTERNS) {
    if (pattern.test(key)) return { isRead: true, isHeartbeat }
  }
  return { isRead: false, isHeartbeat: false }
}

function isTriggeringAction(method: string, path: string): string | null {
  const key = `${method.toUpperCase()} ${path.split('?')[0]}`
  for (const { pattern, label } of TRIGGERING_PATTERNS) {
    if (pattern.test(key)) return label
  }
  return null
}

// ── Agent extraction ───────────────────────────────────────────────────────

/**
 * Extract agent name from request context.
 * Tries: URL params, query params, body, from header.
 */
export function extractAgent(
  method: string,
  url: string,
  query: Record<string, unknown>,
  body: unknown,
  headers: Record<string, string | string[] | undefined>,
): string | null {
  // URL param patterns: /heartbeat/:agent, /inbox/:agent, /me/:agent
  const urlMatch = url.match(/\/(?:heartbeat|inbox|me)\/([a-z][a-z0-9_-]*)(?:\/|\?|$)/i)
  if (urlMatch) return urlMatch[1].toLowerCase()

  // Query param: agent=
  if (query.agent && typeof query.agent === 'string') return query.agent.toLowerCase()

  // Body: from, agent, assignee
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    const candidate = b.from ?? b.agent ?? b.assignee
    if (typeof candidate === 'string' && candidate.length > 0) return candidate.toLowerCase()
  }

  // Header: x-agent-id
  const agentHeader = headers['x-agent-id']
  if (typeof agentHeader === 'string') return agentHeader.toLowerCase()

  return null
}

// ── DB setup ───────────────────────────────────────────────────────────────

let dbReady = false

function ensureTable(): void {
  if (dbReady) return
  try {
    const db = getDb()
    db.exec(`
      CREATE TABLE IF NOT EXISTS compliance_violations (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        session_id TEXT NOT NULL,
        violation_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        triggering_call TEXT NOT NULL,
        last_state_read_at INTEGER,
        window_elapsed_ms INTEGER,
        window_used_ms INTEGER NOT NULL,
        detected_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_compliance_violations_agent ON compliance_violations(agent);
      CREATE INDEX IF NOT EXISTS idx_compliance_violations_detected_at ON compliance_violations(detected_at);
    `)
    dbReady = true
  } catch {
    // DB not available (e.g. test env) — run in degraded mode
  }
}

function persistViolation(v: ComplianceViolation): void {
  try {
    const db = getDb()
    db.prepare(`
      INSERT OR REPLACE INTO compliance_violations
        (id, agent, session_id, violation_type, severity, triggering_call,
         last_state_read_at, window_elapsed_ms, window_used_ms, detected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      v.id,
      v.agent,
      v.session_id,
      v.violation_type,
      v.severity,
      v.triggering_call,
      v.last_state_read_at,
      v.window_elapsed_ms,
      v.window_used_ms,
      v.detected_at,
    )
  } catch {
    // Silent — never block a request due to compliance logging failure
  }
}

// ── Core detector ──────────────────────────────────────────────────────────

/**
 * Called for every request that completes successfully (statusCode < 400).
 * Records state reads and checks triggering actions for compliance.
 */
export function processRequest(
  method: string,
  url: string,
  statusCode: number,
  query: Record<string, unknown>,
  body: unknown,
  headers: Record<string, string | string[] | undefined>,
  now = Date.now(),
): ComplianceViolation | null {
  // Only track successful requests
  if (statusCode >= 400) return null

  const agent = extractAgent(method, url, query, body, headers)
  if (!agent) return null

  // Skip system/watchdog agents
  if (['system', 'watchdog', 'openai'].includes(agent)) return null

  ensureTable()

  const path = url.split('?')[0]
  const session = getOrCreateSession(agent, now)
  const sessionId = getSessionKey(agent, now)

  // Record state read
  const { isRead, isHeartbeat } = isStateRead(method, path)
  if (isRead) {
    session.lastStateReadAt = now
    session.lastReadWasHeartbeat = isHeartbeat
    return null
  }

  // Check triggering action
  const triggerLabel = isTriggeringAction(method, path)
  if (!triggerLabel) return null

  // Determine window
  const windowMs = session.lastReadWasHeartbeat
    ? WINDOW_HEARTBEAT_MS
    : session.hasActiveTask
      ? WINDOW_LONG_MS
      : WINDOW_NORMAL_MS

  const lastReadAt = session.lastStateReadAt
  const windowElapsedMs = lastReadAt !== null ? now - lastReadAt : null

  // Evaluate violation
  let violationType: ViolationType | null = null
  let severity: ViolationSeverity = 'medium'

  if (lastReadAt === null) {
    // No state read at all this session
    violationType = 'no_state_read_before_action'
    severity = 'high'
  } else if (windowElapsedMs !== null && windowElapsedMs > windowMs) {
    // State read exists but window expired
    violationType = 'stale_state_read'
    severity = 'medium'
  }

  if (!violationType) return null

  const violation: ComplianceViolation = {
    id: `cv-${now}-${Math.random().toString(36).slice(2, 9)}`,
    agent,
    session_id: sessionId,
    violation_type: violationType,
    severity,
    triggering_call: triggerLabel,
    last_state_read_at: lastReadAt,
    window_elapsed_ms: windowElapsedMs,
    window_used_ms: windowMs,
    detected_at: now,
  }

  persistViolation(violation)
  return violation
}

/**
 * Mark a session as having an active doing task (extends window to 30 min).
 */
export function setSessionHasActiveTask(agent: string, hasTask: boolean, now = Date.now()): void {
  const session = getOrCreateSession(agent, now)
  session.hasActiveTask = hasTask
}

// ── Query API ──────────────────────────────────────────────────────────────

export interface ViolationQueryOptions {
  agent?: string
  severity?: ViolationSeverity
  limit?: number
  since?: number
}

export function queryViolations(opts: ViolationQueryOptions = {}): ComplianceViolation[] {
  try {
    const db = getDb()
    ensureTable()

    const { agent, severity, limit = 100, since } = opts

    const conditions: string[] = []
    const params: unknown[] = []

    if (agent) {
      conditions.push('agent = ?')
      params.push(agent.toLowerCase())
    }
    if (severity) {
      conditions.push('severity = ?')
      params.push(severity)
    }
    if (since) {
      conditions.push('detected_at >= ?')
      params.push(since)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db.prepare(
      `SELECT * FROM compliance_violations ${where} ORDER BY detected_at DESC LIMIT ?`,
    ).all(...params, limit) as ComplianceViolation[]

    return rows
  } catch {
    return []
  }
}

export function getViolationSummary(since?: number): {
  total: number
  byAgent: Record<string, number>
  bySeverity: Record<string, number>
  sinceMs: number
} {
  const cutoff = since ?? (Date.now() - 24 * 60 * 60 * 1000) // default 24h
  const violations = queryViolations({ since: cutoff, limit: 10_000 })

  const byAgent: Record<string, number> = {}
  const bySeverity: Record<string, number> = {}

  for (const v of violations) {
    byAgent[v.agent] = (byAgent[v.agent] ?? 0) + 1
    bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1
  }

  return {
    total: violations.length,
    byAgent,
    bySeverity,
    sinceMs: cutoff,
  }
}
