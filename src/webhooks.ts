// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Webhook Delivery Engine
 *
 * Durable webhook delivery with:
 *   - Idempotency keys (UUID per delivery attempt)
 *   - Exponential backoff retries (configurable max attempts)
 *   - Dead letter queue for permanently failed deliveries
 *   - Replay: resend any webhook from the audit trail
 *   - TTL-based payload retention with configurable window
 *   - SQLite-backed persistence
 */

import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'

// ── Types ──

export type WebhookStatus = 'pending' | 'delivering' | 'delivered' | 'retrying' | 'dead_letter'

export interface WebhookEvent {
  id: string
  idempotencyKey: string
  provider: string
  eventType: string
  payload: string          // JSON string
  targetUrl: string
  status: WebhookStatus
  attempts: number
  maxAttempts: number
  nextRetryAt: number | null
  lastAttemptAt: number | null
  lastError: string | null
  lastStatusCode: number | null
  deliveredAt: number | null
  createdAt: number
  expiresAt: number        // TTL
  metadata?: string        // JSON string for extra context
}

export interface WebhookDeliveryResult {
  success: boolean
  statusCode: number | null
  error: string | null
  duration: number
}

export interface WebhookStats {
  total: number
  pending: number
  delivering: number
  delivered: number
  retrying: number
  deadLetter: number
  oldestPending: number | null
}

export interface WebhookConfig {
  maxAttempts: number
  initialBackoffMs: number
  maxBackoffMs: number
  backoffMultiplier: number
  retentionMs: number       // TTL for payload storage
  deliveryTimeoutMs: number
  maxConcurrent: number
}

// ── Constants ──

const DEFAULT_CONFIG: WebhookConfig = {
  maxAttempts: 5,
  initialBackoffMs: 1_000,       // 1s
  maxBackoffMs: 300_000,         // 5 minutes
  backoffMultiplier: 2,
  retentionMs: 7 * 24 * 60 * 60 * 1000,  // 7 days
  deliveryTimeoutMs: 30_000,     // 30s
  maxConcurrent: 10,
}

// ── Schema ──

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT UNIQUE NOT NULL,
    provider TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    target_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    next_retry_at INTEGER,
    last_attempt_at INTEGER,
    last_error TEXT,
    last_status_code INTEGER,
    delivered_at INTEGER,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    metadata TEXT
  )
`

const CREATE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_webhook_status ON webhook_events(status)',
  'CREATE INDEX IF NOT EXISTS idx_webhook_next_retry ON webhook_events(next_retry_at)',
  'CREATE INDEX IF NOT EXISTS idx_webhook_provider ON webhook_events(provider)',
  'CREATE INDEX IF NOT EXISTS idx_webhook_expires ON webhook_events(expires_at)',
  'CREATE INDEX IF NOT EXISTS idx_webhook_idempotency ON webhook_events(idempotency_key)',
]

// ── Webhook Delivery Manager ──

export class WebhookDeliveryManager {
  private config: WebhookConfig
  private retryTimer: ReturnType<typeof setInterval> | null = null
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private activeDeliveries = 0
  private initialized = false

  constructor(config: Partial<WebhookConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Initialize database tables and start background loops */
  init(): void {
    if (this.initialized) return

    const db = getDb()
    db.exec(CREATE_TABLE)
    for (const idx of CREATE_INDEXES) {
      db.exec(idx)
    }

    // Retry loop: check for retryable webhooks every 5s
    this.retryTimer = setInterval(() => {
      this.processRetries().catch(err => {
        console.error('[Webhooks] Retry loop error:', err.message)
      })
    }, 5_000)
    this.retryTimer.unref()

    // Cleanup loop: purge expired payloads every hour
    this.cleanupTimer = setInterval(() => {
      this.purgeExpired()
    }, 60 * 60 * 1000)
    this.cleanupTimer.unref()

    this.initialized = true
    console.log('[Webhooks] Delivery engine initialized')
  }

  /** Stop background loops */
  stop(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer)
      this.retryTimer = null
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * Enqueue a webhook for delivery.
   * Returns the webhook event with idempotency key.
   */
  enqueue(params: {
    provider: string
    eventType: string
    payload: unknown
    targetUrl: string
    idempotencyKey?: string
    metadata?: Record<string, unknown>
    maxAttempts?: number
    retentionMs?: number
  }): WebhookEvent {
    const now = Date.now()
    const id = `whe_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const idempotencyKey = params.idempotencyKey || `idk_${randomUUID()}`
    const maxAttempts = params.maxAttempts ?? this.config.maxAttempts
    const retentionMs = params.retentionMs ?? this.config.retentionMs

    const db = getDb()

    // Check idempotency — if key exists, return existing event
    const existing = db.prepare(
      'SELECT * FROM webhook_events WHERE idempotency_key = ?'
    ).get(idempotencyKey) as WebhookEventRow | undefined

    if (existing) {
      return this.rowToEvent(existing)
    }

    const payloadStr = typeof params.payload === 'string'
      ? params.payload
      : JSON.stringify(params.payload)

    const metadataStr = params.metadata ? JSON.stringify(params.metadata) : null

    db.prepare(`
      INSERT INTO webhook_events (
        id, idempotency_key, provider, event_type, payload, target_url,
        status, attempts, max_attempts, next_retry_at,
        created_at, expires_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, ?, ?, ?)
    `).run(
      id, idempotencyKey, params.provider, params.eventType,
      payloadStr, params.targetUrl,
      maxAttempts, now, now + retentionMs, metadataStr
    )

    const event: WebhookEvent = {
      id,
      idempotencyKey,
      provider: params.provider,
      eventType: params.eventType,
      payload: payloadStr,
      targetUrl: params.targetUrl,
      status: 'pending',
      attempts: 0,
      maxAttempts,
      nextRetryAt: null,
      lastAttemptAt: null,
      lastError: null,
      lastStatusCode: null,
      deliveredAt: null,
      createdAt: now,
      expiresAt: now + retentionMs,
      metadata: metadataStr ?? undefined,
    }

    // Attempt immediate delivery
    this.deliverAsync(event)

    return event
  }

  /** Get a webhook event by ID */
  get(id: string): WebhookEvent | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM webhook_events WHERE id = ?').get(id) as WebhookEventRow | undefined
    return row ? this.rowToEvent(row) : null
  }

  /** Get a webhook event by idempotency key */
  getByIdempotencyKey(key: string): WebhookEvent | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM webhook_events WHERE idempotency_key = ?').get(key) as WebhookEventRow | undefined
    return row ? this.rowToEvent(row) : null
  }

  /** List webhook events with filters */
  list(params: {
    status?: WebhookStatus
    provider?: string
    limit?: number
    offset?: number
  } = {}): WebhookEvent[] {
    const db = getDb()
    const conditions: string[] = []
    const values: unknown[] = []

    if (params.status) {
      conditions.push('status = ?')
      values.push(params.status)
    }
    if (params.provider) {
      conditions.push('provider = ?')
      values.push(params.provider)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = params.limit ?? 50
    const offset = params.offset ?? 0

    const rows = db.prepare(
      `SELECT * FROM webhook_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...values, limit, offset) as WebhookEventRow[]

    return rows.map(r => this.rowToEvent(r))
  }

  /** Get dead letter queue entries */
  getDeadLetterQueue(limit: number = 50): WebhookEvent[] {
    return this.list({ status: 'dead_letter', limit })
  }

  /**
   * Replay a webhook: re-enqueue for delivery with a new idempotency key.
   * Original event is preserved in the audit trail.
   */
  replay(id: string): WebhookEvent | null {
    const original = this.get(id)
    if (!original) return null

    // Create new event with fresh idempotency key
    return this.enqueue({
      provider: original.provider,
      eventType: original.eventType,
      payload: original.payload,
      targetUrl: original.targetUrl,
      metadata: {
        ...(original.metadata ? JSON.parse(original.metadata) : {}),
        replayed_from: original.id,
        replayed_at: Date.now(),
      },
    })
  }

  /** Get delivery statistics */
  getStats(): WebhookStats {
    const db = getDb()
    const counts = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'delivering' THEN 1 ELSE 0 END) as delivering,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status = 'retrying' THEN 1 ELSE 0 END) as retrying,
        SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) as dead_letter,
        MIN(CASE WHEN status IN ('pending', 'retrying') THEN created_at ELSE NULL END) as oldest_pending
      FROM webhook_events
    `).get() as Record<string, number | null>

    return {
      total: counts.total ?? 0,
      pending: counts.pending ?? 0,
      delivering: counts.delivering ?? 0,
      delivered: counts.delivered ?? 0,
      retrying: counts.retrying ?? 0,
      deadLetter: counts.dead_letter ?? 0,
      oldestPending: counts.oldest_pending ?? null,
    }
  }

  /** Get delivery config */
  getConfig(): WebhookConfig {
    return { ...this.config }
  }

  /** Update delivery config */
  updateConfig(patch: Partial<WebhookConfig>): WebhookConfig {
    this.config = { ...this.config, ...patch }
    return this.getConfig()
  }

  // ── Private: Delivery ──

  private async deliverAsync(event: WebhookEvent): Promise<void> {
    if (this.activeDeliveries >= this.config.maxConcurrent) {
      return // Will be picked up by retry loop
    }

    this.activeDeliveries++
    try {
      await this.deliver(event)
    } finally {
      this.activeDeliveries--
    }
  }

  private async deliver(event: WebhookEvent): Promise<void> {
    const db = getDb()
    const now = Date.now()

    // Mark as delivering
    db.prepare(
      'UPDATE webhook_events SET status = ?, last_attempt_at = ?, attempts = attempts + 1 WHERE id = ?'
    ).run('delivering', now, event.id)

    const result = await this.attemptDelivery(event)

    if (result.success) {
      // Delivered successfully
      db.prepare(`
        UPDATE webhook_events
        SET status = 'delivered', delivered_at = ?, last_status_code = ?, last_error = NULL
        WHERE id = ?
      `).run(Date.now(), result.statusCode, event.id)
      return
    }

    // Delivery failed
    const updatedAttempts = event.attempts + 1
    if (updatedAttempts >= event.maxAttempts) {
      // Move to dead letter queue
      db.prepare(`
        UPDATE webhook_events
        SET status = 'dead_letter', last_error = ?, last_status_code = ?, next_retry_at = NULL
        WHERE id = ?
      `).run(result.error, result.statusCode, event.id)
      console.log(`[Webhooks] Dead letter: ${event.id} (${event.provider}/${event.eventType}) after ${updatedAttempts} attempts`)
      return
    }

    // Schedule retry with exponential backoff
    const backoffMs = this.calculateBackoff(updatedAttempts)
    const nextRetry = Date.now() + backoffMs

    db.prepare(`
      UPDATE webhook_events
      SET status = 'retrying', last_error = ?, last_status_code = ?, next_retry_at = ?
      WHERE id = ?
    `).run(result.error, result.statusCode, nextRetry, event.id)
  }

  private async attemptDelivery(event: WebhookEvent): Promise<WebhookDeliveryResult> {
    const start = Date.now()

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.config.deliveryTimeoutMs)

      const response = await fetch(event.targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-ID': event.id,
          'X-Idempotency-Key': event.idempotencyKey,
          'X-Webhook-Event': event.eventType,
          'X-Webhook-Provider': event.provider,
          'X-Webhook-Attempt': String(event.attempts + 1),
          'X-Webhook-Timestamp': String(Date.now()),
        },
        body: event.payload,
        signal: controller.signal,
      })

      clearTimeout(timeout)

      const duration = Date.now() - start
      const success = response.status >= 200 && response.status < 300

      return {
        success,
        statusCode: response.status,
        error: success ? null : `HTTP ${response.status} ${response.statusText}`,
        duration,
      }
    } catch (err: any) {
      return {
        success: false,
        statusCode: null,
        error: err?.name === 'AbortError'
          ? `Timeout after ${this.config.deliveryTimeoutMs}ms`
          : (err?.message || 'Network error'),
        duration: Date.now() - start,
      }
    }
  }

  private calculateBackoff(attempt: number): number {
    const backoff = this.config.initialBackoffMs * Math.pow(this.config.backoffMultiplier, attempt - 1)
    // Add jitter: ±20%
    const jitter = backoff * 0.2 * (Math.random() * 2 - 1)
    return Math.min(backoff + jitter, this.config.maxBackoffMs)
  }

  // ── Private: Retry Loop ──

  private async processRetries(): Promise<void> {
    const db = getDb()
    const now = Date.now()

    const retryable = db.prepare(`
      SELECT * FROM webhook_events
      WHERE status = 'retrying'
        AND next_retry_at IS NOT NULL
        AND next_retry_at <= ?
      ORDER BY next_retry_at ASC
      LIMIT ?
    `).all(now, this.config.maxConcurrent - this.activeDeliveries) as WebhookEventRow[]

    // Also pick up pending events that weren't delivered immediately
    const pending = db.prepare(`
      SELECT * FROM webhook_events
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(Math.max(0, this.config.maxConcurrent - this.activeDeliveries - retryable.length)) as WebhookEventRow[]

    const toProcess = [...retryable, ...pending]
    if (toProcess.length === 0) return

    await Promise.allSettled(
      toProcess.map(row => this.deliverAsync(this.rowToEvent(row)))
    )
  }

  // ── Private: Cleanup ──

  private purgeExpired(): void {
    const db = getDb()
    const now = Date.now()
    const result = db.prepare(
      'DELETE FROM webhook_events WHERE expires_at < ? AND status = ?'
    ).run(now, 'delivered')

    if ((result.changes ?? 0) > 0) {
      console.log(`[Webhooks] Purged ${result.changes} expired delivered events`)
    }
  }

  // ── Private: Row Mapping ──

  private rowToEvent(row: WebhookEventRow): WebhookEvent {
    return {
      id: row.id,
      idempotencyKey: row.idempotency_key,
      provider: row.provider,
      eventType: row.event_type,
      payload: row.payload,
      targetUrl: row.target_url,
      status: row.status as WebhookStatus,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      nextRetryAt: row.next_retry_at,
      lastAttemptAt: row.last_attempt_at,
      lastError: row.last_error,
      lastStatusCode: row.last_status_code,
      deliveredAt: row.delivered_at,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      metadata: row.metadata ?? undefined,
    }
  }
}

// ── Row type (SQLite shape) ──

interface WebhookEventRow {
  id: string
  idempotency_key: string
  provider: string
  event_type: string
  payload: string
  target_url: string
  status: string
  attempts: number
  max_attempts: number
  next_retry_at: number | null
  last_attempt_at: number | null
  last_error: string | null
  last_status_code: number | null
  delivered_at: number | null
  created_at: number
  expires_at: number
  metadata: string | null
}

// ── Singleton ──

let _manager: WebhookDeliveryManager | null = null

export function getWebhookDeliveryManager(config?: Partial<WebhookConfig>): WebhookDeliveryManager {
  if (!_manager) {
    _manager = new WebhookDeliveryManager(config)
  }
  return _manager
}
