// SPDX-License-Identifier: Apache-2.0
// Inbound webhook body storage — persist raw email/SMS/webhook payloads for agent processing
import { getDb } from './db.js'

export interface WebhookPayload {
  id: string
  source: string
  eventType: string
  agentId: string | null
  body: Record<string, unknown>
  headers: Record<string, string>
  processed: boolean
  createdAt: number
}

interface PayloadRow {
  id: string
  source: string
  event_type: string
  agent_id: string | null
  body: string
  headers: string
  processed: number
  created_at: number
}

function rowToPayload(row: PayloadRow): WebhookPayload {
  return {
    id: row.id,
    source: row.source,
    eventType: row.event_type,
    agentId: row.agent_id,
    body: JSON.parse(row.body),
    headers: JSON.parse(row.headers),
    processed: row.processed === 1,
    createdAt: row.created_at,
  }
}

function generateId(): string {
  return `whk-${Date.now()}-${Math.random().toString(36).slice(2, 13)}`
}

/**
 * Store an inbound webhook payload.
 */
export function storeWebhookPayload(opts: {
  source: string
  eventType: string
  agentId?: string
  body: Record<string, unknown>
  headers?: Record<string, string>
}): WebhookPayload {
  const db = getDb()
  const id = generateId()
  const now = Date.now()

  db.prepare(`
    INSERT INTO webhook_payloads (id, source, event_type, agent_id, body, headers, processed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, opts.source, opts.eventType, opts.agentId ?? null, JSON.stringify(opts.body), JSON.stringify(opts.headers ?? {}), now)

  return { id, source: opts.source, eventType: opts.eventType, agentId: opts.agentId ?? null, body: opts.body, headers: opts.headers ?? {}, processed: false, createdAt: now }
}

/**
 * Get a webhook payload by ID.
 */
export function getWebhookPayload(id: string): WebhookPayload | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM webhook_payloads WHERE id = ?').get(id) as PayloadRow | undefined
  return row ? rowToPayload(row) : null
}

/**
 * List webhook payloads with filters.
 */
export function listWebhookPayloads(opts?: {
  source?: string
  agentId?: string
  unprocessedOnly?: boolean
  since?: number
  limit?: number
}): WebhookPayload[] {
  const db = getDb()
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts?.source) { conditions.push('source = ?'); params.push(opts.source) }
  if (opts?.agentId) { conditions.push('agent_id = ?'); params.push(opts.agentId) }
  if (opts?.unprocessedOnly) { conditions.push('processed = 0') }
  if (opts?.since) { conditions.push('created_at >= ?'); params.push(opts.since) }

  if (conditions.length === 0) conditions.push('1=1')
  const limit = opts?.limit ?? 50

  return (db.prepare(`SELECT * FROM webhook_payloads WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as PayloadRow[]).map(rowToPayload)
}

/**
 * Mark a payload as processed.
 */
export function markPayloadProcessed(id: string): boolean {
  const db = getDb()
  const result = db.prepare('UPDATE webhook_payloads SET processed = 1 WHERE id = ? AND processed = 0').run(id)
  return result.changes > 0
}

/**
 * Get unprocessed count.
 */
export function getUnprocessedCount(opts?: { source?: string; agentId?: string }): number {
  const db = getDb()
  const conditions = ['processed = 0']
  const params: unknown[] = []
  if (opts?.source) { conditions.push('source = ?'); params.push(opts.source) }
  if (opts?.agentId) { conditions.push('agent_id = ?'); params.push(opts.agentId) }
  return (db.prepare(`SELECT COUNT(*) as c FROM webhook_payloads WHERE ${conditions.join(' AND ')}`).get(...params) as { c: number }).c
}

/**
 * Delete old processed payloads (retention).
 */
export function purgeOldPayloads(maxAgeDays: number): number {
  const db = getDb()
  const cutoff = Date.now() - (maxAgeDays * 86400000)
  const result = db.prepare('DELETE FROM webhook_payloads WHERE processed = 1 AND created_at < ?').run(cutoff)
  return result.changes
}
