// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Cloud Connectivity State Machine
 *
 * Tracks cloud connection health and manages degradation modes:
 *   - connected: cloud healthy, heartbeats succeeding
 *   - degraded: intermittent failures, local ops continue
 *   - offline: sustained outage, local-only with queue buffering
 *
 * Transition thresholds are configurable for testing.
 */

import { eventBus } from './events.js'

// ── Types ──

export type ConnectivityMode = 'connected' | 'degraded' | 'offline'

export interface ConnectivityState {
  mode: ConnectivityMode
  lastSuccessAt: number | null
  lastFailureAt: number | null
  consecutiveFailures: number
  consecutiveSuccesses: number
  degradedReason: string | null
  degradedSince: number | null
  offlineSince: number | null
  queueDepth: number
  oldestQueuedEventAge: number | null
  transitionHistory: Array<{
    from: ConnectivityMode
    to: ConnectivityMode
    at: number
    reason: string
  }>
}

export interface ConnectivityThresholds {
  /** Consecutive failures to enter degraded (default: 3) */
  degradedAfterFailures: number
  /** Ms of sustained degraded to enter offline (default: 300_000 = 5min) */
  offlineAfterMs: number
  /** Consecutive successes to recover from degraded/offline (default: 2) */
  recoveryAfterSuccesses: number
}

// ── Default Thresholds ──

const DEFAULT_THRESHOLDS: ConnectivityThresholds = {
  degradedAfterFailures: 3,
  offlineAfterMs: 300_000,  // 5 minutes
  recoveryAfterSuccesses: 2,
}

// ── Connectivity Manager ──

export class ConnectivityManager {
  private state: ConnectivityState
  private thresholds: ConnectivityThresholds

  constructor(thresholds: Partial<ConnectivityThresholds> = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds }
    this.state = {
      mode: 'connected',
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      degradedReason: null,
      degradedSince: null,
      offlineSince: null,
      queueDepth: 0,
      oldestQueuedEventAge: null,
      transitionHistory: [],
    }
  }

  /** Get current connectivity state */
  getState(): ConnectivityState {
    return {
      ...this.state,
      oldestQueuedEventAge: this.state.oldestQueuedEventAge
        ? Date.now() - this.state.oldestQueuedEventAge
        : null,
      transitionHistory: [...this.state.transitionHistory],
    }
  }

  /** Get current mode */
  getMode(): ConnectivityMode {
    return this.state.mode
  }

  /** Get thresholds (for dashboard display) */
  getThresholds(): ConnectivityThresholds {
    return { ...this.thresholds }
  }

  /** Update thresholds (for testing) */
  setThresholds(patch: Partial<ConnectivityThresholds>): void {
    this.thresholds = { ...this.thresholds, ...patch }
  }

  /**
   * Record a successful cloud interaction (heartbeat, sync, etc.)
   */
  recordSuccess(): void {
    const now = Date.now()
    this.state.lastSuccessAt = now
    this.state.consecutiveFailures = 0
    this.state.consecutiveSuccesses++

    if (this.state.mode !== 'connected') {
      if (this.state.consecutiveSuccesses >= this.thresholds.recoveryAfterSuccesses) {
        this.transition('connected', 'recovered')
      }
    }
  }

  /**
   * Record a failed cloud interaction
   */
  recordFailure(reason: string = 'unknown'): void {
    const now = Date.now()
    this.state.lastFailureAt = now
    this.state.consecutiveSuccesses = 0
    this.state.consecutiveFailures++

    if (this.state.mode === 'connected') {
      if (this.state.consecutiveFailures >= this.thresholds.degradedAfterFailures) {
        this.state.degradedReason = reason
        this.transition('degraded', reason)
      }
    } else if (this.state.mode === 'degraded') {
      // Check if we should go offline
      const degradedDuration = this.state.degradedSince
        ? now - this.state.degradedSince
        : 0
      if (degradedDuration >= this.thresholds.offlineAfterMs) {
        this.transition('offline', `sustained degraded for ${Math.round(degradedDuration / 1000)}s`)
      }
    }
  }

  /**
   * Update queue depth (for status reporting)
   */
  updateQueueDepth(depth: number, oldestEventTimestamp?: number): void {
    this.state.queueDepth = depth
    this.state.oldestQueuedEventAge = oldestEventTimestamp ?? null
  }

  /**
   * Reset to connected state (for testing)
   */
  reset(): void {
    this.state = {
      mode: 'connected',
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      degradedReason: null,
      degradedSince: null,
      offlineSince: null,
      queueDepth: 0,
      oldestQueuedEventAge: null,
      transitionHistory: [],
    }
  }

  // ── Private ──

  private transition(to: ConnectivityMode, reason: string): void {
    const from = this.state.mode
    if (from === to) return

    const now = Date.now()
    this.state.transitionHistory.push({ from, to, at: now, reason })

    // Keep history bounded
    if (this.state.transitionHistory.length > 100) {
      this.state.transitionHistory = this.state.transitionHistory.slice(-50)
    }

    this.state.mode = to

    if (to === 'degraded') {
      this.state.degradedSince = now
      this.state.offlineSince = null
    } else if (to === 'offline') {
      this.state.offlineSince = now
    } else if (to === 'connected') {
      this.state.degradedSince = null
      this.state.offlineSince = null
      this.state.degradedReason = null
      this.state.consecutiveFailures = 0
    }

    console.log(`[Connectivity] ${from} → ${to} (${reason})`)

    // Emit event for dashboard/monitoring
    try {
      eventBus.emit({
        id: `evt-conn-${now}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'presence_updated',
        timestamp: now,
        data: { kind: 'cloud_connectivity', from, to, reason },
      })
    } catch {
      // Non-critical — don't break connectivity tracking if event emission fails
    }
  }
}

// ── Singleton ──

let _manager: ConnectivityManager | null = null

export function getConnectivityManager(thresholds?: Partial<ConnectivityThresholds>): ConnectivityManager {
  if (!_manager) {
    _manager = new ConnectivityManager(thresholds)
  }
  return _manager
}
