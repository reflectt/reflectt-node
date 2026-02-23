// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Noise Budget — Control-Plane Message Rate Limiter
 *
 * P0-1 implementation for task-1771341488434-778v3hg36
 *
 * Tracks control-plane vs content messages per channel (rolling 24h window).
 * Enforces per-channel budgets with duplicate suppression and digest batching.
 *
 * Denominator definition (per spec):
 *   - Includes: human + agent content messages in #general
 *   - Excludes: bot acks, reactions, join/leave, system edit/delete events
 *
 * Three enforcement mechanisms:
 *   1. Duplicate suppression — dedup identical messages within a window
 *   2. Digest batching — queue low-priority messages into periodic digests
 *   3. Per-channel budget — hard cap on control-plane ratio per channel
 */

import { createHash } from 'crypto'
import { eventBus } from './events.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface NoiseBudgetConfig {
  /** Enable noise budget enforcement (default: true) */
  enabled: boolean
  /** Canary mode — log only, don't suppress (default: true for first 24h) */
  canaryMode: boolean
  /** Rolling window size in ms (default: 24h) */
  windowMs: number
  /** Per-channel budget: max ratio of control-plane messages (0-1, default: 0.30) */
  channelBudgets: Record<string, number>
  /** Default budget for channels without explicit config */
  defaultBudget: number
  /** Duplicate suppression window in ms (default: 10 min) */
  dedupWindowMs: number
  /** Digest batch interval in ms (default: 30 min) */
  digestIntervalMs: number
  /** Categories that bypass all budget enforcement */
  bypassCategories: string[]
  /** Maximum digest queue size before force-flush */
  maxDigestQueueSize: number
}

export interface MessageRecord {
  id: string
  channel: string
  from: string
  contentHash: string
  category: string
  isControlPlane: boolean
  timestamp: number
  suppressed: boolean
  suppressReason?: string
}

export interface ChannelBudgetState {
  channel: string
  totalMessages: number
  controlPlaneMessages: number
  contentMessages: number
  currentRatio: number
  budgetLimit: number
  overBudget: boolean
  suppressedCount: number
  digestedCount: number
}

export interface NoiseBudgetSnapshot {
  timestamp: number
  windowMs: number
  canaryMode: boolean
  channels: Record<string, ChannelBudgetState>
  totalSuppressed: number
  totalDigested: number
  dedupHits: number
  digestQueueSize: number
}

export interface DigestEntry {
  from: string
  content: string
  category: string
  channel: string
  originalTimestamp: number
  taskId?: string | null
}

export interface SuppressionResult {
  allowed: boolean
  reason?: string
  /** If message was queued for digest instead of suppressed */
  digested?: boolean
}

// Control-plane message categories (system-generated enforcement/automation)
const CONTROL_PLANE_CATEGORIES = new Set([
  'watchdog-alert',
  'status-update',
  'digest',
  'system-info',
  'continuity-loop',
  'mention-rescue',
])

// Categories that are never control-plane (always count as content)
const CONTENT_CATEGORIES = new Set([
  'ship-notice',
  'review-request',
  'blocker',
  'escalation',
])

// ── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: NoiseBudgetConfig = {
  enabled: true,
  canaryMode: true, // Start in canary mode — log only
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  channelBudgets: {
    general: 0.30, // 30% max control-plane in #general (target from spec)
  },
  defaultBudget: 0.50, // More lenient for other channels
  dedupWindowMs: 10 * 60 * 1000, // 10 minutes
  digestIntervalMs: 30 * 60 * 1000, // 30 minutes
  bypassCategories: ['escalation', 'blocker', 'critical'],
  maxDigestQueueSize: 50,
}

// ── Noise Budget Manager ───────────────────────────────────────────────────

export class NoiseBudgetManager {
  private config: NoiseBudgetConfig
  private messageLog: MessageRecord[] = []
  private dedupCache: Map<string, number> = new Map() // hash -> timestamp
  private digestQueue: DigestEntry[] = []
  private digestTimer: ReturnType<typeof setInterval> | null = null
  private suppressionLog: Array<{
    timestamp: number
    channel: string
    from: string
    reason: string
    category: string
    contentPreview: string
  }> = []
  private totalDedupHits = 0
  private totalDigested = 0
  private onDigestFlush: ((channel: string, entries: DigestEntry[]) => Promise<void>) | null = null

  constructor(config?: Partial<NoiseBudgetConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    if (this.config.enabled) {
      this.startDigestTimer()
    }
  }

  // ── Core: Pre-send Check ───────────────────────────────────────────────

  /**
   * Check if a message should be allowed through, suppressed, or digested.
   * Called from routeMessage() BEFORE sending.
   */
  checkMessage(opts: {
    from: string
    content: string
    channel: string
    category?: string
    severity?: string
    taskId?: string | null
  }): SuppressionResult {
    if (!this.config.enabled) {
      return { allowed: true }
    }

    const category = opts.category || 'system-info'
    const severity = opts.severity || 'info'

    // 1. Bypass categories always pass
    if (this.config.bypassCategories.includes(category) || severity === 'critical') {
      this.recordMessage(opts.channel, opts.from, opts.content, category, false, false)
      return { allowed: true }
    }

    const isControlPlane = CONTROL_PLANE_CATEGORIES.has(category)
    const contentHash = this.hashContent(opts.from, opts.content, opts.channel)

    // 2. Duplicate suppression
    const lastSeen = this.dedupCache.get(contentHash)
    const now = Date.now()
    if (lastSeen && (now - lastSeen) < this.config.dedupWindowMs) {
      this.totalDedupHits++
      this.logSuppression(opts.channel, opts.from, 'duplicate', category, opts.content)
      this.recordMessage(opts.channel, opts.from, opts.content, category, isControlPlane, true, 'duplicate')

      if (this.config.canaryMode) {
        // Canary: log but don't suppress
        return { allowed: true, reason: 'canary-would-suppress-duplicate' }
      }
      return { allowed: false, reason: 'duplicate-suppressed' }
    }

    // Update dedup cache
    this.dedupCache.set(contentHash, now)

    // 3. Per-channel budget check (only for control-plane messages)
    if (isControlPlane) {
      const budgetState = this.getChannelBudgetState(opts.channel)
      if (budgetState.overBudget) {
        // Queue for digest instead of sending directly
        this.digestQueue.push({
          from: opts.from,
          content: opts.content,
          category,
          channel: opts.channel,
          originalTimestamp: now,
          taskId: opts.taskId,
        })

        if (this.digestQueue.length >= this.config.maxDigestQueueSize) {
          this.flushDigestQueue().catch(() => {})
        }

        this.logSuppression(opts.channel, opts.from, 'over-budget-digested', category, opts.content)
        this.recordMessage(opts.channel, opts.from, opts.content, category, true, true, 'over-budget')

        if (this.config.canaryMode) {
          return { allowed: true, reason: 'canary-would-digest-over-budget' }
        }
        return { allowed: false, digested: true, reason: 'over-budget-queued-for-digest' }
      }
    }

    // 4. Allow through
    this.recordMessage(opts.channel, opts.from, opts.content, category, isControlPlane, false)
    return { allowed: true }
  }

  // ── Message Recording ──────────────────────────────────────────────────

  private recordMessage(
    channel: string,
    from: string,
    content: string,
    category: string,
    isControlPlane: boolean,
    suppressed: boolean,
    suppressReason?: string,
  ): void {
    const now = Date.now()
    this.messageLog.push({
      id: `nb-${now}-${Math.random().toString(36).substr(2, 6)}`,
      channel,
      from,
      contentHash: this.hashContent(from, content, channel),
      category,
      isControlPlane,
      timestamp: now,
      suppressed,
      suppressReason,
    })

    // Prune old entries outside window
    const cutoff = now - this.config.windowMs
    this.messageLog = this.messageLog.filter(r => r.timestamp >= cutoff)

    // Prune old dedup cache entries
    for (const [hash, ts] of this.dedupCache) {
      if (now - ts > this.config.dedupWindowMs) {
        this.dedupCache.delete(hash)
      }
    }
  }

  /**
   * Record a content message (non-routed, direct agent/human message).
   * Called to track the denominator accurately.
   */
  recordContentMessage(channel: string, from: string): void {
    const now = Date.now()
    this.messageLog.push({
      id: `nb-content-${now}-${Math.random().toString(36).substr(2, 6)}`,
      channel,
      from,
      contentHash: '',
      category: 'content',
      isControlPlane: false,
      timestamp: now,
      suppressed: false,
    })

    // Prune
    const cutoff = now - this.config.windowMs
    this.messageLog = this.messageLog.filter(r => r.timestamp >= cutoff)
  }

  // ── Budget State ───────────────────────────────────────────────────────

  getChannelBudgetState(channel: string): ChannelBudgetState {
    const now = Date.now()
    const cutoff = now - this.config.windowMs
    const channelMessages = this.messageLog.filter(
      r => r.channel === channel && r.timestamp >= cutoff && !r.suppressed
    )

    const controlPlane = channelMessages.filter(r => r.isControlPlane).length
    const content = channelMessages.filter(r => !r.isControlPlane).length
    const total = channelMessages.length
    const ratio = total > 0 ? controlPlane / total : 0
    const budgetLimit = this.config.channelBudgets[channel] ?? this.config.defaultBudget

    const suppressedInWindow = this.messageLog.filter(
      r => r.channel === channel && r.timestamp >= cutoff && r.suppressed
    )
    const digestedInWindow = suppressedInWindow.filter(
      r => r.suppressReason === 'over-budget'
    )

    return {
      channel,
      totalMessages: total,
      controlPlaneMessages: controlPlane,
      contentMessages: content,
      currentRatio: Math.round(ratio * 1000) / 1000,
      budgetLimit,
      overBudget: ratio >= budgetLimit && total >= 10, // Need min 10 messages before enforcing
      suppressedCount: suppressedInWindow.length,
      digestedCount: digestedInWindow.length,
    }
  }

  // ── Digest Batching ────────────────────────────────────────────────────

  private startDigestTimer(): void {
    if (this.digestTimer) return
    this.digestTimer = setInterval(() => {
      this.flushDigestQueue().catch(err => {
        console.error('[NoiseBudget] Digest flush error:', err)
      })
    }, this.config.digestIntervalMs)
  }

  async flushDigestQueue(): Promise<DigestEntry[]> {
    if (this.digestQueue.length === 0) return []

    const entries = [...this.digestQueue]
    this.digestQueue = []
    this.totalDigested += entries.length

    // Group by channel
    const byChannel = new Map<string, DigestEntry[]>()
    for (const entry of entries) {
      const list = byChannel.get(entry.channel) || []
      list.push(entry)
      byChannel.set(entry.channel, list)
    }

    // Call flush handler for each channel
    if (this.onDigestFlush) {
      for (const [channel, channelEntries] of byChannel) {
        try {
          await this.onDigestFlush(channel, channelEntries)
        } catch (err) {
          console.error(`[NoiseBudget] Digest flush failed for ${channel}:`, err)
        }
      }
    }

    return entries
  }

  /**
   * Register a handler that sends digest messages.
   * Called by server startup to wire digest → chat.
   */
  setDigestFlushHandler(handler: (channel: string, entries: DigestEntry[]) => Promise<void>): void {
    this.onDigestFlush = handler
  }

  // ── Snapshot / Canary Metrics ──────────────────────────────────────────

  getSnapshot(): NoiseBudgetSnapshot {
    const channels: Record<string, ChannelBudgetState> = {}
    const allChannels = new Set(this.messageLog.map(r => r.channel))

    for (const channel of allChannels) {
      channels[channel] = this.getChannelBudgetState(channel)
    }

    return {
      timestamp: Date.now(),
      windowMs: this.config.windowMs,
      canaryMode: this.config.canaryMode,
      channels,
      totalSuppressed: this.suppressionLog.length,
      totalDigested: this.totalDigested,
      dedupHits: this.totalDedupHits,
      digestQueueSize: this.digestQueue.length,
    }
  }

  /**
   * Get canary metrics for rollback evaluation.
   * Returns signals for the three rollback triggers from spec.
   */
  getCanaryMetrics(): {
    snapshot: NoiseBudgetSnapshot
    rollbackSignals: {
      /** SLA miss increase > 5pp vs baseline? (placeholder — needs SLA data) */
      slaMissIncrease: number | null
      /** P95 first-response increase > 20%? (placeholder — needs response data) */
      p95ResponseIncrease: number | null
      /** Critical reminder misses count */
      criticalReminderMisses: number
      /** Whether any rollback trigger is tripped */
      rollbackTriggered: boolean
    }
  } {
    const snapshot = this.getSnapshot()

    // Critical reminder misses = messages suppressed with category containing 'escalation' or critical
    // (These should never be suppressed due to bypass, but track anyway)
    const criticalMisses = this.suppressionLog.filter(
      s => s.category === 'escalation' || s.category === 'critical'
    ).length

    return {
      snapshot,
      rollbackSignals: {
        slaMissIncrease: null, // TODO: Wire to SLA tracker
        p95ResponseIncrease: null, // TODO: Wire to response time tracker
        criticalReminderMisses: criticalMisses,
        rollbackTriggered: criticalMisses >= 3,
      },
    }
  }

  // ── Suppression Log ────────────────────────────────────────────────────

  private logSuppression(
    channel: string,
    from: string,
    reason: string,
    category: string,
    content: string,
  ): void {
    this.suppressionLog.push({
      timestamp: Date.now(),
      channel,
      from,
      reason,
      category,
      contentPreview: content.substring(0, 100),
    })

    // Keep last 500 entries
    if (this.suppressionLog.length > 500) {
      this.suppressionLog.splice(0, this.suppressionLog.length - 500)
    }

    console.log(`[NoiseBudget] Suppressed: channel=${channel} from=${from} reason=${reason} category=${category}`)
  }

  getSuppressionLog(options?: { limit?: number; since?: number }): typeof this.suppressionLog {
    let log = this.suppressionLog
    if (options?.since) {
      log = log.filter(e => e.timestamp >= options.since!)
    }
    log = log.slice().sort((a, b) => b.timestamp - a.timestamp)
    if (options?.limit) {
      log = log.slice(0, options.limit)
    }
    return log
  }

  // ── Config ─────────────────────────────────────────────────────────────

  getConfig(): Readonly<NoiseBudgetConfig> {
    return { ...this.config }
  }

  updateConfig(updates: Partial<NoiseBudgetConfig>): void {
    this.config = { ...this.config, ...updates }
    if (this.config.enabled && !this.digestTimer) {
      this.startDigestTimer()
    }
    if (!this.config.enabled && this.digestTimer) {
      clearInterval(this.digestTimer)
      this.digestTimer = null
    }
    console.log('[NoiseBudget] Config updated:', JSON.stringify(updates))
  }

  /** Exit canary mode — start enforcing suppression */
  activateEnforcement(): void {
    this.config.canaryMode = false
    console.log('[NoiseBudget] Canary mode OFF — enforcement active')
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private hashContent(from: string, content: string, channel: string): string {
    // Normalize: trim, lowercase, remove timestamps/IDs that change
    const normalized = `${from}:${channel}:${content.trim().toLowerCase().replace(/\b(msg-|task-|tcomment-)\S+/g, '').replace(/\d{13,}/g, '')}`
    return createHash('sha256').update(normalized).digest('hex').substring(0, 16)
  }

  /** Stop timers for clean shutdown */
  stop(): void {
    if (this.digestTimer) {
      clearInterval(this.digestTimer)
      this.digestTimer = null
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

export const noiseBudgetManager = new NoiseBudgetManager()
